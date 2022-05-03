import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .addBearerAuth()
    .setTitle('Api cotação')
    .setDescription('Portal cotações')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  app.enableCors({
    origin: [
      'http://localhost:3005/',
      'http://localhost:3001',
      'http://localhost:5000',
      //   'http://localhost:3001',
    ],
    methods: ["GET", "POST"],
  })

  //app.enableCors();
  //await app.listen(4005);
  await app.listen(3050);
}
bootstrap();
