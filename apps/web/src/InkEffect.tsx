import { forwardRef, useMemo } from "react";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Color, Uniform } from "three";
import { INK_COLOR } from "./toon";

/**
 * Contorno de desenho em tela cheia: detecta bordas pela profundidade (silhuetas e sobreposições), em pixels.
 * Vale para o jogo inteiro (personagens, cenários, mesa) e não cria linhas entre partes contínuas de um mesmo
 * objeto, porque usa a segunda derivada de 1/z (planos têm derivada zero).
 */
const fragment = /* glsl */ `
uniform vec3 inkColor;
uniform float thickness;
uniform float threshold;

float invZ(vec2 uv) {
  float z = -getViewZ(readDepth(uv));
  return 1.0 / max(z, 0.0001);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 o = texelSize * thickness;
  float c = invZ(uv);
  float x1 = invZ(uv + vec2(o.x, 0.0));
  float x2 = invZ(uv - vec2(o.x, 0.0));
  float y1 = invZ(uv + vec2(0.0, o.y));
  float y2 = invZ(uv - vec2(0.0, o.y));
  float edge = max(abs(x1 + x2 - 2.0 * c), abs(y1 + y2 - 2.0 * c)) / max(c, 0.0005);
  float e = smoothstep(threshold, threshold * 2.2, edge);
  outputColor = vec4(mix(inputColor.rgb, inkColor, e * 0.92), inputColor.a);
}
`;

class InkEffectImpl extends Effect {
  constructor(thickness: number, threshold: number) {
    super("InkEffect", fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ["inkColor", new Uniform(new Color(INK_COLOR))],
        ["thickness", new Uniform(thickness)],
        ["threshold", new Uniform(threshold)],
      ]),
    });
  }
}

export const Ink = forwardRef<InkEffectImpl, { thickness?: number; threshold?: number }>(function Ink({ thickness = 1.4, threshold = 0.05 }, ref) {
  const effect = useMemo(() => new InkEffectImpl(thickness, threshold), [thickness, threshold]);
  return <primitive ref={ref} object={effect} dispose={null} />;
});
