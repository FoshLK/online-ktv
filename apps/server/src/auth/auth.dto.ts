import { Transform } from "class-transformer";
import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(2, 32)
  @Matches(/^[\p{L}\p{N}_-]+$/u, { message: "用户名只能包含文字、数字、下划线和短横线" })
  username!: string;

  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8, { message: "密码至少需要 8 个字符" })
  @MaxLength(128)
  password!: string;
}

export class VerifyEmailDto {
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  email!: string;

  @Transform(({ value }) => String(value).trim())
  @Matches(/^\d{6}$/, { message: "验证码必须是 6 位数字" })
  code!: string;
}

export class ResendVerificationDto {
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  email!: string;
}

export class LoginDto {
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(2, 254)
  login!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @MinLength(40)
  @MaxLength(500)
  refreshToken!: string;
}
