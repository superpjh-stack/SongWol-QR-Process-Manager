# 운영 배포용 프론트 빌드 이미지. 정적 산출물만 만들고, 실제 서빙은 nginx 서비스가 맡는다
# (`docker-compose.prod.yml` 의 named volume `webdist` 로 전달). 빌드 컨텍스트는 저장소 루트.
FROM node:24-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# 운영 API 는 같은 origin(nginx 가 /api·/ws 를 backend 로 프록시)이므로 VITE_PROXY_TARGET 불필요.
RUN npm run build

# dist/ 를 named volume(webdist)에 복사하고 종료하는 1회성 컨테이너.
FROM alpine:3.20
COPY --from=build /app/dist /dist
CMD ["sh", "-c", "rm -rf /out/* && cp -r /dist/. /out/ && echo 'web dist copied to /out'"]
