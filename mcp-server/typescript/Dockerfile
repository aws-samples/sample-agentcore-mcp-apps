FROM public.ecr.aws/docker/library/node:22-slim AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src/ src/
RUN npx tsc

FROM public.ecr.aws/docker/library/node:22-slim
WORKDIR /app
COPY --from=builder /app/dist dist/
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/package.json .
COPY widgets/ widgets/
EXPOSE 8000
CMD ["node", "dist/index.js"]
