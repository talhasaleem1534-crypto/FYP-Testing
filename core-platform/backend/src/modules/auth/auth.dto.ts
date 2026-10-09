import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty({ message: 'Please enter your name' })
  @MaxLength(80)
  name: string;

  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(200)
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(200)
  password: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Please enter your password' })
  @MaxLength(200)
  password: string;
}
