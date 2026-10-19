use reqwest::Url;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const MAX_ASSET_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedAsset {
    path: String,
    sha256: String,
    size_bytes: u64,
    cache_hit: bool,
}

#[tauri::command]
async fn cache_song_asset(
    app: AppHandle,
    url: String,
    access_token: String,
    song_id: String,
    asset_version: u32,
    expected_sha256: String,
    file_name: String,
) -> Result<CachedAsset, String> {
    validate_segment(&song_id, "songId")?;
    validate_segment(&file_name, "fileName")?;
    if access_token.trim().is_empty() {
        return Err("登录令牌为空".to_string());
    }

    let expected = expected_sha256.to_ascii_lowercase();
    if expected.len() != 64
        || !expected
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("资源 SHA-256 格式无效".to_string());
    }

    let parsed_url = Url::parse(&url).map_err(|_| "资源下载地址无效".to_string())?;
    if !matches!(parsed_url.scheme(), "http" | "https") || parsed_url.host_str().is_none() {
        return Err("资源下载地址必须使用 HTTP 或 HTTPS".to_string());
    }

    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位缓存目录：{error}"))?;
    let destination = cache_root
        .join("songs")
        .join(&song_id)
        .join(format!("v{asset_version}"))
        .join(&file_name);

    if let Some(existing) = verify_cached_file(&destination, &expected).await? {
        return Ok(existing);
    }
    if tokio::fs::try_exists(&destination).await.unwrap_or(false) {
        tokio::fs::remove_file(&destination)
            .await
            .map_err(|error| format!("无法清理损坏缓存：{error}"))?;
    }

    let parent = destination
        .parent()
        .ok_or_else(|| "缓存目标目录无效".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("无法创建缓存目录：{error}"))?;
    let temporary = destination.with_extension(format!(
        "{}.part",
        destination
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("asset")
    ));
    let _ = tokio::fs::remove_file(&temporary).await;

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(10 * 60))
        .build()
        .map_err(|error| format!("无法初始化下载器：{error}"))?;
    let mut response = client
        .get(parsed_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("资源下载失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("资源服务器返回状态 {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_ASSET_BYTES)
    {
        return Err("资源超过 100 MB 下载限制".to_string());
    }

    let result = download_to_file(&mut response, &temporary, &expected).await;
    let (actual_sha256, size_bytes) = match result {
        Ok(value) => value,
        Err(error) => {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(error);
        }
    };
    if actual_sha256 != expected {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err("资源 SHA-256 校验失败，已删除临时文件".to_string());
    }

    tokio::fs::rename(&temporary, &destination)
        .await
        .map_err(|error| format!("无法提交资源缓存：{error}"))?;
    Ok(CachedAsset {
        path: destination.to_string_lossy().into_owned(),
        sha256: actual_sha256,
        size_bytes,
        cache_hit: false,
    })
}

async fn download_to_file(
    response: &mut reqwest::Response,
    temporary: &Path,
    _expected: &str,
) -> Result<(String, u64), String> {
    let mut output = tokio::fs::File::create(temporary)
        .await
        .map_err(|error| format!("无法创建缓存文件：{error}"))?;
    let mut digest = Sha256::new();
    let mut size_bytes = 0_u64;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("读取资源数据失败：{error}"))?
    {
        size_bytes = size_bytes.saturating_add(chunk.len() as u64);
        if size_bytes > MAX_ASSET_BYTES {
            return Err("资源超过 100 MB 下载限制".to_string());
        }
        digest.update(&chunk);
        output
            .write_all(&chunk)
            .await
            .map_err(|error| format!("写入资源缓存失败：{error}"))?;
    }
    output
        .flush()
        .await
        .map_err(|error| format!("刷新资源缓存失败：{error}"))?;
    Ok((format!("{:x}", digest.finalize()), size_bytes))
}

async fn verify_cached_file(path: &PathBuf, expected: &str) -> Result<Option<CachedAsset>, String> {
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        return Ok(None);
    }
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("无法读取已有缓存：{error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut size_bytes = 0_u64;
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("校验已有缓存失败：{error}"))?;
        if read == 0 {
            break;
        }
        size_bytes += read as u64;
        digest.update(&buffer[..read]);
    }
    let actual = format!("{:x}", digest.finalize());
    if actual != expected {
        return Ok(None);
    }
    Ok(Some(CachedAsset {
        path: path.to_string_lossy().into_owned(),
        sha256: actual,
        size_bytes,
        cache_hit: true,
    }))
}

fn validate_segment(value: &str, label: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        });
    if valid {
        Ok(())
    } else {
        Err(format!("{label} 包含不安全字符"))
    }
}

#[cfg(test)]
mod tests {
    use super::validate_segment;

    #[test]
    fn accepts_safe_cache_segments() {
        assert!(validate_segment("5f11946e-d449-4ddc-a2ed-484c48be126e", "songId").is_ok());
        assert!(validate_segment("audio-v1.mp3", "fileName").is_ok());
    }

    #[test]
    fn rejects_path_traversal_and_separators() {
        for value in [
            "",
            ".",
            "..",
            "../secret",
            "folder/file.mp3",
            "folder\\file.mp3",
        ] {
            assert!(
                validate_segment(value, "fileName").is_err(),
                "unexpected safe value: {value}"
            );
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![cache_song_asset])
        .run(tauri::generate_context!())
        .expect("error while running KTV client");
}
