import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(){
 const app=await NestFactory.create(AppModule,{cors:true});
 app.setGlobalPrefix('api');
 app.enableShutdownHooks();
 const port=Number(process.env.CHAIN_VERIFY_API_PORT||process.env.PORT||3001);
 await app.listen(port,'0.0.0.0');
}
void bootstrap();
