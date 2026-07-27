export const MEDIA_MODEL_SNIPPET = `model Media {
  id                   String   @id
  modelType            String
  modelId              String
  uuid                 String   @unique
  collectionName       String
  name                 String
  fileName             String
  mimeType             String?
  disk                 String
  conversionsDisk      String?
  size                 Int
  manipulations        Json
  customProperties     Json
  generatedConversions Json
  responsiveImages     Json
  orderColumn          Int?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([modelType, modelId])
  @@map("media")
}`
