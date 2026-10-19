import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { diskStorage } from "multer";

export interface UploadedSongFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  path: string;
  size: number;
}

export interface UploadedSongFiles {
  audio?: UploadedSongFile[];
  lyric?: UploadedSongFile[];
}

const uploadDirectory = fileURLToPath(new URL("../../../../storage/uploads/", import.meta.url));

export const songUploadOptions = {
  storage: diskStorage({
    destination: (_request, _file, callback) => {
      mkdir(uploadDirectory, { recursive: true })
        .then(() => callback(null, uploadDirectory))
        .catch((error: Error) => callback(error, uploadDirectory));
    },
    filename: (_request, file, callback) => {
      const extension = extname(file.originalname).toLowerCase().slice(0, 10);
      callback(null, `${randomUUID()}${extension}`);
    },
  }),
  limits: {
    files: 2,
    fields: 8,
    parts: 10,
    fileSize: 100 * 1024 * 1024,
    fieldSize: 16 * 1024,
  },
};
