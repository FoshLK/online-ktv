import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from "class-validator";

export class AdminUserQueryDto {
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MaxLength(100)
  q = "";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

export class AdminUpdateUserDto {
  @IsOptional()
  @IsIn(["ACTIVE", "SUSPENDED", "DISABLED"])
  status?: "ACTIVE" | "SUSPENDED" | "DISABLED";

  @IsOptional()
  @IsIn(["USER", "ADMIN", "SUPER_ADMIN"])
  role?: "USER" | "ADMIN" | "SUPER_ADMIN";

  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(3, 500)
  reason!: string;
}
