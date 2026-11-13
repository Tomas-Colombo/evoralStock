declare module 'bwip-js' {
  export interface RenderOptions {
    bcid: string
    text: string
    scale?: number
    scaleX?: number
    scaleY?: number
    width?: number
    height?: number
    includetext?: boolean
    textxalign?: string
    textyalign?: string
    textsize?: number
    textgaps?: number
    alttext?: string
    rotate?: string
    monochrome?: boolean
    barcolor?: string
    textcolor?: string
    bordercolor?: string
    backgroundcolor?: string
    paddingwidth?: number
    paddingheight?: number
    guardheight?: number
    guardleftpos?: number
    guardrightpos?: number
    guardwidth?: number
    guardleftypos?: number
    guardrightypos?: number
  }

  export function toSVG(opts: RenderOptions): string
  export function toCanvas(canvas: unknown, opts: RenderOptions): unknown

  const bwipjs: {
    toSVG(opts: RenderOptions): string
    toCanvas(canvas: unknown, opts: RenderOptions): unknown
  }

  export default bwipjs
}
