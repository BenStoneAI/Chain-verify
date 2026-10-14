import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

/**
 * Number of reverse-proxy hops in front of the API (Render's load balancer = 1).
 * Express then derives `req.ip` (the rate-limit key) from X-Forwarded-For instead of
 * the proxy's socket address, which would put every client in one rate-limit bucket.
 */
function trustProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw.trim() === '') return 1;
  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 0 ? hops : 1;
}

async function bootstrap(){
 const app=await NestFactory.create<NestExpressApplication>(AppModule,{cors:true,rawBody:true});
 app.set('trust proxy',trustProxyHops());
 app.setGlobalPrefix('api');
 app.enableShutdownHooks();
 const port=Number(process.env.CHAIN_VERIFY_API_PORT||process.env.PORT||3001);
 await app.listen(port,'0.0.0.0');
}
void bootstrap();
