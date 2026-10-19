import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from "class-validator";

export class CreateRoomDto {
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(1, 64)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(50)
  capacity!: number;

  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MaxLength(500)
  announcement?: string;
}

export class UpdateRoomDto {
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(1, 64)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(50)
  capacity?: number;

  @IsOptional()
  @Transform(({ value }) => value === null ? null : String(value).trim())
  @IsString()
  @MaxLength(500)
  announcement?: string | null;
}
