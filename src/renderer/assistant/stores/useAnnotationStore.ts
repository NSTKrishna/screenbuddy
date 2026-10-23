import { create } from 'zustand'

/** Mirrors whether the overlay is showing annotations, for the Clear button and Esc. */
export const useAnnotationStore = create<{ visible: boolean }>()(() => ({ visible: false }))
