import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from "class-validator";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class ImportSongDto {
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  title!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  artist!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  album?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(7_200_000)
  durationMs!: number;

  @Transform(trim)
  @IsString()
  @Length(3, 1_000)
  copyrightNote!: string;

  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  rightsConfirmed!: boolean;
}

export class AdminSongQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q = "";
}

export class UpdateSongStatusDto {
  @IsIn(["PUBLISHED", "DISABLED"])
  status!: "PUBLISHED" | "DISABLED";

  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason!: string;
}
