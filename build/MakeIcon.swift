// MakeIcon - draws the app icon.
//
// The mark is the buddy itself: the orange robot (boy-1) standing on a soft
// rounded square. The robot is rendered by art/render_icon.py from the same
// builders as the app's character, so the icon cannot drift from it. This tool
// only sets that render on its plate.
//
// The plate follows the macOS icon grid: an 824 px rounded square in the middle
// of the 1024 px canvas, the rest left clear for its soft shadow. A cool plate
// because the robot is cream and orange: the cream stays clear of it, and the
// orange eyes are the one warm spot.
//
//   npm run build:icon
//   swift build/MakeIcon.swift art/out/robot.png build/icon.png

import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let args = CommandLine.arguments
guard args.count > 2 else {
    FileHandle.standardError.write(Data("usage: MakeIcon <robot.png> <icon.png>\n".utf8))
    exit(2)
}
let robotPath = args[1]
let out = args[2]

guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: robotPath) as CFURL, nil),
      let robot = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    FileHandle.standardError.write(Data("cannot read \(robotPath): run art/render_icon.py first\n".utf8))
    exit(1)
}

let cs = CGColorSpace(name: CGColorSpace.sRGB)!
guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                          bytesPerRow: 0, space: cs,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fatalError("no context")
}

let S = CGFloat(size)
func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: cs, components: [r/255, g/255, b/255, a])!
}

let skyTop = rgb(220, 239, 255)
let skyBottom = rgb(132, 173, 240)
let shade = (r: CGFloat(29), g: CGFloat(58), b: CGFloat(122))   // what the robot's shadows are tinted with

// The plate: macOS squircle proportion, on the 824 px grid.
let plateSize: CGFloat = 824
let plateRect = CGRect(x: (S - plateSize) / 2, y: (S - plateSize) / 2, width: plateSize, height: plateSize)
let radius = plateSize * 0.2237
let plate = CGPath(roundedRect: plateRect, cornerWidth: radius, cornerHeight: radius, transform: nil)

// Its shadow, falling a little below.
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 26, color: rgb(0, 0, 0, 0.28))
ctx.addPath(plate)
ctx.setFillColor(skyBottom)
ctx.fillPath()
ctx.restoreGState()

// Everything on the plate is clipped to it.
ctx.saveGState()
ctx.addPath(plate)
ctx.clip()

if let sky = CGGradient(colorsSpace: cs, colors: [skyTop, skyBottom] as CFArray, locations: [0, 1]) {
    ctx.drawLinearGradient(sky, start: CGPoint(x: 0, y: plateRect.maxY), end: CGPoint(x: 0, y: plateRect.minY), options: [])
}

// Light from above: a broad, soft sheen over the top of the plate.
if let sheen = CGGradient(colorsSpace: cs, colors: [rgb(255, 255, 255, 0.30), rgb(255, 255, 255, 0)] as CFArray,
                          locations: [0, 1]) {
    let at = CGPoint(x: S / 2, y: plateRect.maxY + plateSize * 0.10)
    ctx.drawRadialGradient(sheen, startCenter: at, startRadius: 0, endCenter: at, endRadius: plateSize * 0.75, options: [])
}

// The robot's contact shadow: a flat ellipse under its feet.
ctx.saveGState()
ctx.translateBy(x: S / 2, y: plateRect.minY + plateSize * 0.105)
ctx.scaleBy(x: 1, y: 0.22)
if let contact = CGGradient(colorsSpace: cs,
                            colors: [rgb(shade.r, shade.g, shade.b, 0.45), rgb(shade.r, shade.g, shade.b, 0)] as CFArray,
                            locations: [0, 1]) {
    ctx.drawRadialGradient(contact, startCenter: .zero, startRadius: 0, endCenter: .zero,
                           endRadius: plateSize * 0.27, options: [])
}
ctx.restoreGState()

// The robot: its render is square, with the robot filling its height almost to the edge.
// A soft shadow of its own keeps its cream edge clear of the plate.
let robotSize: CGFloat = 736
let robotRect = CGRect(x: (S - robotSize) / 2, y: plateRect.minY + plateSize * 0.045,
                       width: robotSize, height: robotSize)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 22, color: rgb(shade.r, shade.g, shade.b, 0.30))
ctx.interpolationQuality = .high
ctx.draw(robot, in: robotRect)
ctx.restoreGState()
ctx.restoreGState()

// The plate's rim: light along the top, a touch of shade along the bottom.
ctx.saveGState()
ctx.addPath(plate)
ctx.clip()
ctx.addPath(plate)
ctx.setLineWidth(5)   // half of it falls outside the plate, and is clipped away
ctx.replacePathWithStrokedPath()
ctx.clip()
if let rim = CGGradient(colorsSpace: cs,
                        colors: [rgb(255, 255, 255, 0.55), rgb(255, 255, 255, 0), rgb(shade.r, shade.g, shade.b, 0.18)] as CFArray,
                        locations: [0, 0.55, 1]) {
    ctx.drawLinearGradient(rim, start: CGPoint(x: 0, y: plateRect.maxY), end: CGPoint(x: 0, y: plateRect.minY), options: [])
}
ctx.restoreGState()

guard let image = ctx.makeImage() else { fatalError("no image") }
let url = URL(fileURLWithPath: out)
guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("no destination")
}
CGImageDestinationAddImage(dest, image, nil)
CGImageDestinationFinalize(dest)
print("wrote \(out) at \(size)x\(size)")
