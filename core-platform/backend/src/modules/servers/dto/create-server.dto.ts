import { IsString, IsNotEmpty, IsInt, IsOptional, IsBoolean, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateServerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsString()
  @Matches(/^[A-Za-z0-9]([A-Za-z0-9.:-]*[A-Za-z0-9])?$/, { message: 'host must be a hostname or IP address' })
  @MaxLength(253)
  host: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number = 22;

  @IsString()
  @Matches(/^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/, { message: 'ssh_user is not a valid username' })
  ssh_user: string;

  /** Optional: your own private key. Leave empty to use the platform key (recommended). */
  @IsString()
  @IsOptional()
  @MaxLength(20000)
  ssh_private_key?: string;

  /** Admin only: customers may deploy to this server (default true). Ignored for customers. */
  @IsBoolean()
  @IsOptional()
  shared?: boolean;

  @IsBoolean()
  @IsOptional()
  docker_installed?: boolean = true;
}
