import sharp from "sharp";

const ALLOWED_INPUT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MIN_FILE_SIZE = 32;
const MAX_OUTPUT_FILE_SIZE = 5 * 1024 * 1024;
const MAX_DIMENSION = 2000;
const MAX_INPUT_PIXELS = 4_000_000;
const WEBP_QUALITY = 90;

export type AllowedInputMimeType =
  (typeof ALLOWED_INPUT_MIME_TYPES)[number];

export interface ProcessedImageResult {
  buffer: Buffer;
  contentType: "image/webp";
  extension: "webp";
  width: number;
  height: number;
  originalSize: number;
  processedSize: number;
}

export interface ImageProcessError {
  error: string;
}

export type ImageProcessResult =
  | ProcessedImageResult
  | ImageProcessError;

function isAllowedMimeType(
  mimeType: string
): mimeType is AllowedInputMimeType {
  return ALLOWED_INPUT_MIME_TYPES.includes(
    mimeType as AllowedInputMimeType
  );
}

export async function processImageToWebP(
  file: File
): Promise<ImageProcessResult> {
  if (!file || !(file instanceof File)) {
    return {
      error: "Nenhum arquivo enviado.",
    };
  }

  if (!isAllowedMimeType(file.type)) {
    return {
      error:
        "Tipo de arquivo não permitido. Apenas JPEG, PNG e WEBP são aceitos.",
    };
  }

  if (file.size < MIN_FILE_SIZE || file.size > MAX_FILE_SIZE) {
    return {
      error:
        "O tamanho do arquivo excede o limite máximo de 5MB.",
    };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    const metadata = await sharp(inputBuffer).metadata();

    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_INPUT_PIXELS) {
      return {
        error: "Arquivo de imagem inválido ou corrompido.",
      };
    }

    const isValidFormat = ["jpeg", "png", "webp"].includes(
      metadata.format || ""
    );

    if (!isValidFormat) {
      return {
        error:
          "Formato de imagem não suportado. Apenas JPEG, PNG e WEBP são aceitos.",
      };
    }

    const pipeline = sharp(inputBuffer);

    if (
      metadata.width > MAX_DIMENSION ||
      metadata.height > MAX_DIMENSION
    ) {
      pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const processedBuffer = await pipeline
      .webp({
        quality: WEBP_QUALITY,
      })
      .toBuffer();

    if (processedBuffer.length < MIN_FILE_SIZE || processedBuffer.length > MAX_OUTPUT_FILE_SIZE) {
      return { error: "A imagem processada excede os limites permitidos." };
    }

    const processedMetadata =
      await sharp(processedBuffer).metadata();

    return {
      buffer: processedBuffer,
      contentType: "image/webp",
      extension: "webp",
      width:
        processedMetadata.width || metadata.width,
      height:
        processedMetadata.height || metadata.height,
      originalSize: inputBuffer.length,
      processedSize: processedBuffer.length,
    };
  } catch (err) {
    console.error("Image processing error:", err);

    return {
      error:
        "Falha ao processar a imagem. Verifique se o arquivo é uma imagem válida.",
    };
  }
}

export function generateSafeFilePath(
  _originalFileName: string,
  extension: string
): string {
  const uniqueId = crypto.randomUUID();

  return `${uniqueId}.${extension}`;
}