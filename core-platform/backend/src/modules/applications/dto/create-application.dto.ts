import { IsString, IsNotEmpty, IsOptional, IsInt, IsObject, IsIn, Matches, Max, MaxLength, Min } from 'class-validator';
import { APP_TYPE_IDS } from '../../app-types/app-types';

export class CreateApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(63)
  name: string;

  @IsString()
  @Matches(/^(https?:\/\/|ssh:\/\/|git:\/\/|git@)[^\s'"`$;|&<>\\]+$/i, {
    message: 'repo_url must start with https://, ssh://, git:// or git@ and contain no spaces or shell characters',
  })
  @MaxLength(500)
  repo_url: string;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/, { message: 'Invalid branch name' })
  branch?: string = 'main';

  /** Optional: defaults to the local server. */
  @IsString()
  @IsOptional()
  server_id?: string;

  @IsString()
  @IsOptional()
  @IsIn(['dockerfile', 'nixpacks', 'compose'])
  build_method?: 'dockerfile' | 'nixpacks' | 'compose' = 'dockerfile';

  /** Flask, Next.js, Static HTML... decides how the app is built. Default: auto-detect. */
  @IsString()
  @IsOptional()
  @IsIn(APP_TYPE_IDS, { message: `app_type must be one of: ${APP_TYPE_IDS.join(', ')}` })
  app_type?: string = 'auto';

  /** Leave empty to use the app type's default. One line only (it becomes the container's CMD). */
  @IsString()
  @IsOptional()
  @MaxLength(300)
  @Matches(/^[^\r\n\0]*$/, { message: 'start_command must be a single line' })
  start_command?: string;

  @IsString()
  @Matches(/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/, { message: 'domain must be a valid hostname' })
  domain: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number;

  @IsObject()
  @IsOptional()
  env_vars?: Record<string, string> = {};
}

export class ScaleApplicationDto {
  @IsInt()
  @Min(1)
  @Max(10)
  replicas: number;
}
