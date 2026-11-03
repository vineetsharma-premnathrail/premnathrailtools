import type React from 'react'

/** catalogue key -> screen code -> the screen component to mount inside the Visibility preview overlay.
 * Each component reads the preview context through useVisibility(key) (vis.preview) and takes no props. */
export type PreviewScreens = Record<string, Record<string, React.ComponentType>>
