import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export class PreparePlaybackDto {
  @IsUUID()
  songId!: string;
}

export class PlaybackControlDto {
  @IsIn(["PAUSE", "RESUME", "SEEK", "STOP"])
  action!: "PAUSE" | "RESUME" | "SEEK" | "STOP";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60 * 1000)
  positionMs?: number;
}
