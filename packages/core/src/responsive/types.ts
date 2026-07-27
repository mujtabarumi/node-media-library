export interface ResponsiveVariant {
  fileName: string
  width: number
  height: number
}

/** Stored under `MediaRecord.responsiveImages[conversionName]`. */
export interface ResponsiveImagesEntry {
  files: ResponsiveVariant[]
  /** base64 SVG data URI (LQIP); absent when placeholders are disabled. */
  placeholder?: string
}
