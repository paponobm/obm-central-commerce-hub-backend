import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(cookieParser());

  // Uploaded category/product images live outside the "api" prefix — a
  // plain static file at /uploads/<name>, not a controller route.
  // process.cwd() (not __dirname) so this resolves to the project root
  // whether running via ts-node in dev or the compiled dist/ build in
  // prod — __dirname would differ between the two and silently break one.
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // Admin panel + storefronts run on separate origins/ports from the API.
  // credentials:true is required for the httpOnly refresh-token cookie to
  // be sent/set cross-origin — which is also why origin can't be '*' here.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
