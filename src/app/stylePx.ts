import { options, type VNode } from 'preact';

/**
 * Preact 11 不再自動替 style 的數字加 px（style={{ width: 300 }} 會被整個忽略），
 * 這裡比照 preact/compat 補回來：非無單位屬性（lineHeight、flex、zIndex、opacity…）的數字一律加 px。
 * 必須在第一次 render 之前載入。
 */
const IS_NON_DIMENSIONAL = /^(-|f[lo].*[^se]$|g.{5,}[^ps]$|z|o[pr]|(W.{5})?[lL]i.*(t|mp)$|an|(bo|s).{4}Im|sca|m.{6}[ds]|ta|c.*[st]$|wido|ini|asp|fill|st)/;

const prev = options.vnode;
options.vnode = (vnode: VNode) => {
  const props = vnode.props as { style?: Record<string, unknown> } | null;
  const style = props?.style;
  if (typeof vnode.type === 'string' && style && style.constructor === Object) {
    let cloned: Record<string, unknown> | null = null;
    for (const k in style) {
      const v = style[k];
      if (typeof v === 'number' && !IS_NON_DIMENSIONAL.test(k)) {
        if (!cloned) cloned = props!.style = { ...style };
        cloned[k] = `${v}px`;
      }
    }
  }
  prev?.(vnode);
};
