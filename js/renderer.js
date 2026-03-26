/**
 * LVGL Widget Renderer
 * Renders widget instances as HTML/CSS elements that visually approximate LVGL widgets.
 * Handles style application, orientation detection, and custom knob rendering.
 */

const LVGLRenderer = (() => {

    /**
     * Parse a color value from various formats to a CSS color string.
     * Supports: 0xRRGGBB, #RRGGBB, CSS color names
     */
    function parseColor(val) {
        if (val == null || val === '') return null;
        if (typeof val === 'string') {
            if (val.startsWith('0x') || val.startsWith('0X')) {
                return '#' + val.slice(2).padStart(6, '0');
            }
            if (val.startsWith('#')) return val;
            return val; // CSS color name
        }
        if (typeof val === 'number') {
            return '#' + val.toString(16).padStart(6, '0');
        }
        return null;
    }

    /**
     * Parse an opacity value to a CSS-compatible number (0-1).
     * Supports: 0-100 (percentage), 0%-100%, TRANSP, COVER
     * Plain numbers are treated as percentages (matching the UI input).
     */
    function parseOpacity(val) {
        if (val == null || val === '') return null;
        if (typeof val === 'string') {
            const lower = val.toLowerCase();
            if (lower === 'transp') return 0;
            if (lower === 'cover') return 1;
            if (lower.endsWith('%')) return parseFloat(lower) / 100;
            // Plain number string: treat as 0-100 percentage
            const num = parseFloat(lower);
            if (!isNaN(num)) return Math.min(num, 100) / 100;
            return null;
        }
        if (typeof val === 'number') {
            // Numbers > 1 are percentages (0-100), not 0-255
            if (val > 1 && val <= 100) return val / 100;
            return val;
        }
        return null;
    }

    /**
     * Convert a CSS color string to rgba with alpha.
     */
    function colorWithAlpha(cssColor, alpha) {
        if (!cssColor) return cssColor;
        // Parse hex color
        let r = 0, g = 0, b = 0;
        if (cssColor.startsWith('#')) {
            const hex = cssColor.slice(1);
            if (hex.length === 3) {
                r = parseInt(hex[0] + hex[0], 16);
                g = parseInt(hex[1] + hex[1], 16);
                b = parseInt(hex[2] + hex[2], 16);
            } else if (hex.length === 6) {
                r = parseInt(hex.slice(0, 2), 16);
                g = parseInt(hex.slice(2, 4), 16);
                b = parseInt(hex.slice(4, 6), 16);
            }
            return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
        }
        return cssColor;
    }

    /**
     * Apply text shadow/glow effect to a text element.
     * In LVGL, shadow properties on labels create a glow effect around text.
     * We render this as CSS text-shadow with multiple layers for a convincing glow.
     */
    function applyTextGlow(el, styles) {
        if (!styles || !styles.shadow_color) return;
        const sc = parseColor(styles.shadow_color);
        if (!sc) return;
        const sw = styles.shadow_width || 4;
        const sox = styles.shadow_ofs_x || 0;
        const soy = styles.shadow_ofs_y || 0;
        const spread = styles.shadow_spread || 0;
        const shadowOpa = parseOpacity(styles.shadow_opa);
        let shadowColor = sc;
        if (shadowOpa != null && shadowOpa < 1) {
            shadowColor = colorWithAlpha(sc, shadowOpa);
        }

        // Build layered text-shadow for glow effect
        // Multiple layers at increasing blur create a convincing glow
        const totalBlur = sw + spread;
        const shadows = [];
        // Core sharp layer
        shadows.push(`${sox}px ${soy}px ${Math.round(totalBlur * 0.3)}px ${shadowColor}`);
        // Mid glow layer
        shadows.push(`${sox}px ${soy}px ${Math.round(totalBlur * 0.7)}px ${shadowColor}`);
        // Outer glow layer
        shadows.push(`${sox}px ${soy}px ${totalBlur}px ${shadowColor}`);
        // Extra soft outer for large glows
        if (totalBlur > 6) {
            shadows.push(`${sox}px ${soy}px ${Math.round(totalBlur * 1.5)}px ${shadowColor}`);
        }

        el.style.textShadow = shadows.join(', ');
        // Remove box-shadow since this is text glow, not box glow
        el.style.boxShadow = 'none';
    }

    /**
     * Apply common LVGL style properties to an HTML element.
     */
    function applyStyles(el, styles) {
        if (!styles) return;
        const s = el.style;

        const bg = parseColor(styles.bg_color);
        if (bg) s.backgroundColor = bg;

        const bgOpa = parseOpacity(styles.bg_opa);
        if (bgOpa != null) {
            if (bgOpa === 0) s.backgroundColor = 'transparent';
            else if (bg) {
                s.backgroundColor = bg;
                s.opacity = bgOpa;
            }
        }

        const opa = parseOpacity(styles.opa);
        if (opa != null) s.opacity = opa;

        // Gradient fill
        if (styles.bg_grad_dir && styles.bg_grad_dir !== 'NONE' && styles.bg_grad_color) {
            const gradColor = parseColor(styles.bg_grad_color);
            const baseColor = bg || '#000000';
            if (gradColor) {
                const dir = styles.bg_grad_dir === 'VER' ? 'to bottom' : 'to right';
                // bg_main_stop and bg_grad_stop are 0-255, map to percentage
                const mainStop = styles.bg_main_stop != null ? Math.round((styles.bg_main_stop / 255) * 100) : 0;
                const gradStop = styles.bg_grad_stop != null ? Math.round((styles.bg_grad_stop / 255) * 100) : 100;
                s.background = `linear-gradient(${dir}, ${baseColor} ${mainStop}%, ${gradColor} ${gradStop}%)`;
            }
        }

        if (styles.radius != null) s.borderRadius = styles.radius + 'px';

        const bc = parseColor(styles.border_color);
        if (bc) s.borderColor = bc;
        if (styles.border_width != null) {
            s.borderWidth = styles.border_width + 'px';
            s.borderStyle = 'solid';
        }

        const tc = parseColor(styles.text_color);
        if (tc) s.color = tc;

        if (styles.pad_all != null) s.padding = styles.pad_all + 'px';
        if (styles.pad_top != null) s.paddingTop = styles.pad_top + 'px';
        if (styles.pad_bottom != null) s.paddingBottom = styles.pad_bottom + 'px';
        if (styles.pad_left != null) s.paddingLeft = styles.pad_left + 'px';
        if (styles.pad_right != null) s.paddingRight = styles.pad_right + 'px';

        if (styles.shadow_color) {
            const sc = parseColor(styles.shadow_color);
            const sw = styles.shadow_width || 4;
            const sox = styles.shadow_ofs_x || 0;
            const soy = styles.shadow_ofs_y || 0;
            const spread = styles.shadow_spread || 0;
            const shadowOpa = parseOpacity(styles.shadow_opa);
            let shadowColor = sc;
            // Apply shadow opacity via rgba
            if (shadowOpa != null && shadowOpa < 1 && sc) {
                shadowColor = colorWithAlpha(sc, shadowOpa);
            }
            s.boxShadow = `${sox}px ${soy}px ${sw}px ${spread}px ${shadowColor}`;
        }

        if (styles.outline_color) {
            const oc = parseColor(styles.outline_color);
            const ow = styles.outline_width || 1;
            s.outline = `${ow}px solid ${oc}`;
            if (styles.outline_pad) s.outlineOffset = styles.outline_pad + 'px';
        }

        // Text alignment
        if (styles.text_align) {
            const alignMap = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', AUTO: 'auto' };
            s.textAlign = alignMap[styles.text_align] || styles.text_align;
            // Also update flex alignment for flex-based widgets (labels, buttons)
            const justifyMap = { LEFT: 'flex-start', CENTER: 'center', RIGHT: 'flex-end' };
            if (justifyMap[styles.text_align]) s.justifyContent = justifyMap[styles.text_align];
        }

        // Text font — use FontManager for full CSS or fallback to size extraction
        if (styles.text_font) {
            if (typeof FontManager !== 'undefined') {
                const css = FontManager.getFontCSS(styles.text_font);
                if (css.fontSize) s.fontSize = css.fontSize;
                if (css.fontFamily) s.fontFamily = css.fontFamily;
            } else {
                const sizeMatch = String(styles.text_font).match(/(\d+)/);
                if (sizeMatch) s.fontSize = sizeMatch[1] + 'px';
            }
        }

        // Letter and line spacing
        if (styles.text_letter_space != null) s.letterSpacing = styles.text_letter_space + 'px';
        if (styles.text_line_space != null) s.lineHeight = (1.2 + styles.text_line_space / 14).toFixed(2);
    }

    /**
     * Determine if a slider should be vertical based on its dimensions.
     */
    function isVertical(widget) {
        return widget.height > widget.width;
    }

    /**
     * Convert ESPHome LVGL unicode escapes (\U000FXXXX) to actual characters
     * and render text with MDI icon support.
     */
    function renderLabelText(el, text) {
        // Match ESPHome unicode escape sequences: \U000FXXXX (8-digit) and \uXXXX (4-digit)
        const unicodePattern = /\\U([0-9A-Fa-f]{8})|\\u([0-9A-Fa-f]{4})/g;
        if (!unicodePattern.test(text)) {
            el.textContent = text;
            return;
        }

        unicodePattern.lastIndex = 0;
        let lastIdx = 0;
        let match;
        while ((match = unicodePattern.exec(text)) !== null) {
            if (match.index > lastIdx) {
                el.appendChild(document.createTextNode(text.substring(lastIdx, match.index)));
            }

            const codeHex = match[1] || match[2];
            const codePoint = parseInt(codeHex, 16);

            // Decode the character natively.
            // The widget's font-family (assigned via applyStyles) will handle drawing it.
            el.appendChild(document.createTextNode(String.fromCodePoint(codePoint)));

            lastIdx = match.index + match[0].length;
        }

        if (lastIdx < text.length) {
            el.appendChild(document.createTextNode(text.substring(lastIdx)));
        }
    }

    // ---- Widget Render Functions ----
    // Each returns an HTML element representing the widget's visual appearance.

    const renderers = {

        label(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-label';
            const rawText = widget.properties.text || 'Label';
            renderLabelText(el, rawText);
            applyStyles(el, widget.styles?.main);
            const tc = parseColor(widget.styles?.main?.text_color);
            if (tc) el.style.color = tc;

            // Apply text glow/shadow (renders as text-shadow instead of box-shadow)
            if (widget.styles?.main?.shadow_color) {
                applyTextGlow(el, widget.styles.main);
            }

            // Apply text_align from property (convenience shortcut)
            const align = widget.properties.text_align || widget.styles?.main?.text_align;
            if (align) {
                const cssAlign = { LEFT: 'flex-start', CENTER: 'center', RIGHT: 'flex-end' };
                el.style.justifyContent = cssAlign[align] || 'flex-start';
                el.style.textAlign = align.toLowerCase();
            }

            return el;
        },

        button(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-button';
            applyStyles(el, widget.styles?.main);
            // Render child label text inline (children are not rendered separately)
            if (widget.children && widget.children.length > 0) {
                const childLabel = widget.children.find(c => c.type === 'label');
                if (childLabel) {
                    renderLabelText(el, childLabel.properties?.text || '');
                    // Apply child label's styles (text color, font)
                    const childTc = parseColor(childLabel.styles?.main?.text_color);
                    if (childTc) el.style.color = childTc;
                    if (childLabel.styles?.main?.text_font) {
                        const css = typeof FontManager !== 'undefined'
                            ? FontManager.getFontCSS(childLabel.styles.main.text_font)
                            : {};
                        if (css.fontSize) el.style.fontSize = css.fontSize;
                        if (css.fontFamily) el.style.fontFamily = css.fontFamily;
                    }
                    const childAlign = childLabel.properties?.text_align || childLabel.styles?.main?.text_align;
                    if (childAlign) {
                        const justifyMap = { LEFT: 'flex-start', CENTER: 'center', RIGHT: 'flex-end' };
                        el.style.justifyContent = justifyMap[childAlign] || 'center';
                    }
                }
            } else {
                el.textContent = 'Button';
            }
            return el;
        },

        slider(widget) {
            const el = document.createElement('div');
            const vertical = isVertical(widget);
            el.className = `lvgl-widget lvgl-slider ${vertical ? 'vertical' : 'horizontal'}`;

            // Track fills the entire widget area
            const track = document.createElement('div');
            track.className = 'lvgl-slider-track';
            track.style.width = '100%';
            track.style.height = '100%';
            track.style.position = 'relative';
            track.style.borderRadius = '4px';
            track.style.background = '#404060';
            track.style.overflow = 'visible';
            applyStyles(track, widget.styles?.main);

            const indicator = document.createElement('div');
            indicator.className = 'lvgl-slider-indicator';
            indicator.style.position = 'absolute';
            indicator.style.borderRadius = 'inherit';
            indicator.style.background = '#2196F3';
            applyStyles(indicator, widget.styles?.indicator);

            const min = widget.properties.min_value ?? 0;
            const max = widget.properties.max_value ?? 100;
            const val = widget.properties.value ?? 50;
            const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));

            if (vertical) {
                indicator.style.left = '0';
                indicator.style.bottom = '0';
                indicator.style.width = '100%';
                indicator.style.height = pct + '%';
            } else {
                indicator.style.top = '0';
                indicator.style.left = '0';
                indicator.style.height = '100%';
                indicator.style.width = pct + '%';
            }
            track.appendChild(indicator);

            // Knob - rendered natively from part styles
            const knob = document.createElement('div');
            knob.className = 'lvgl-slider-knob';
            knob.style.position = 'absolute';
            knob.style.zIndex = '2';

            // Native explicit sizing from knob part styles, falling back to dynamic size
            const kw = widget.styles?.knob?.width;
            const kh = widget.styles?.knob?.height;
            const defaultSize = vertical ? widget.width + 6 : widget.height + 6;

            knob.style.width = (kw !== undefined ? kw + 'px' : defaultSize + 'px');
            knob.style.height = (kh !== undefined ? kh + 'px' : defaultSize + 'px');

            // Default styles before applying custom ones
            knob.style.borderRadius = '50%';
            knob.style.background = '#fff';
            knob.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';

            applyStyles(knob, widget.styles?.knob);

            // Hide entirely if user sets transparency
            const knobOpa = parseOpacity(widget.styles?.knob?.bg_opa);
            if (knobOpa === 0) {
                knob.style.display = 'none';
            }

            // Apply padding to adjust knob size (LVGL uses negative padding to shrink)
            if (widget.styles?.knob) {
                const ks = widget.styles.knob;
                let knobW = parseFloat(knob.style.width) || defaultSize;
                let knobH = parseFloat(knob.style.height) || defaultSize;
                if (ks.pad_all != null) {
                    knobW += parseInt(ks.pad_all) * 2;
                    knobH += parseInt(ks.pad_all) * 2;
                }
                if (ks.pad_left != null) knobW += parseInt(ks.pad_left);
                if (ks.pad_right != null) knobW += parseInt(ks.pad_right);
                if (ks.pad_top != null) knobH += parseInt(ks.pad_top);
                if (ks.pad_bottom != null) knobH += parseInt(ks.pad_bottom);
                knob.style.width = Math.max(0, knobW) + 'px';
                knob.style.height = Math.max(0, knobH) + 'px';
            }

            // Position knob centered on the track
            if (vertical) {
                const knobH = parseFloat(knob.style.height) || 20;
                const trackH = widget.height;
                const knobPos = trackH - (pct / 100 * trackH) - knobH / 2;
                knob.style.top = knobPos + 'px';
                knob.style.left = '50%';
                knob.style.transform = 'translateX(-50%)';
            } else {
                const knobW = parseFloat(knob.style.width) || 20;
                const trackW = widget.width;
                const knobPos = (pct / 100 * trackW) - knobW / 2;
                knob.style.left = knobPos + 'px';
                knob.style.top = '50%';
                knob.style.transform = 'translateY(-50%)';
            }

            track.appendChild(knob);

            el.appendChild(track);
            return el;
        },

        arc(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-arc';
            const size = Math.min(widget.width, widget.height);
            const cx = size / 2;
            const cy = size / 2;
            const arcWidth = widget.properties.arc_width || 10;
            const r = (size - arcWidth) / 2;
            const startAngle = widget.properties.start_angle ?? 135;
            const endAngle = widget.properties.end_angle ?? 45;
            const min = widget.properties.min_value ?? 0;
            const max = widget.properties.max_value ?? 100;
            const val = widget.properties.value ?? 50;

            // Calculate total arc span
            let totalSpan = endAngle - startAngle;
            if (totalSpan <= 0) totalSpan += 360;

            const pct = (val - min) / (max - min);
            const valAngle = startAngle + pct * totalSpan;

            function polarToCartesian(cx, cy, r, angleDeg) {
                const rad = (angleDeg - 90) * Math.PI / 180;
                return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
            }
            function describeArc(cx, cy, r, start, end) {
                let sweep = end - start;
                if (sweep < 0) sweep += 360;
                const largeArc = sweep > 180 ? 1 : 0;
                const s = polarToCartesian(cx, cy, r, start);
                const e = polarToCartesian(cx, cy, r, end);
                return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
            }

            const bgColor = parseColor(widget.styles?.main?.bg_color) || '#404060';
            const indColor = parseColor(widget.styles?.indicator?.bg_color) || '#2196F3';

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

            // Background arc
            const bgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            bgPath.setAttribute('d', describeArc(cx, cy, r, startAngle, endAngle));
            bgPath.setAttribute('fill', 'none');
            bgPath.setAttribute('stroke', bgColor);
            bgPath.setAttribute('stroke-width', arcWidth);
            bgPath.setAttribute('stroke-linecap', 'round');
            svg.appendChild(bgPath);

            // Indicator arc
            if (pct > 0.01) {
                const indPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                indPath.setAttribute('d', describeArc(cx, cy, r, startAngle, valAngle));
                indPath.setAttribute('fill', 'none');
                indPath.setAttribute('stroke', indColor);
                indPath.setAttribute('stroke-width', arcWidth);
                indPath.setAttribute('stroke-linecap', 'round');
                svg.appendChild(indPath);
            }

            // Knob
            const knobPos = polarToCartesian(cx, cy, r, valAngle);
            const knobR = arcWidth * 0.7;
            const knobCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            knobCircle.setAttribute('cx', knobPos.x);
            knobCircle.setAttribute('cy', knobPos.y);
            knobCircle.setAttribute('r', knobR);
            knobCircle.setAttribute('fill', parseColor(widget.styles?.knob?.bg_color) || '#fff');
            svg.appendChild(knobCircle);

            el.appendChild(svg);
            return el;
        },

        bar(widget) {
            const el = document.createElement('div');
            const vertical = widget.height > widget.width;
            el.className = `lvgl-widget lvgl-bar ${vertical ? 'vertical' : 'horizontal'}`;
            applyStyles(el, widget.styles?.main);

            const indicator = document.createElement('div');
            indicator.className = 'lvgl-bar-indicator';
            applyStyles(indicator, widget.styles?.indicator);

            const min = widget.properties.min_value ?? 0;
            const max = widget.properties.max_value ?? 100;
            const val = widget.properties.value ?? 50;
            const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));

            if (vertical) {
                indicator.style.height = pct + '%';
            } else {
                indicator.style.width = pct + '%';
            }

            el.appendChild(indicator);
            return el;
        },

        switch(widget) {
            const el = document.createElement('div');
            const checked = widget.properties.checked;
            el.className = `lvgl-widget lvgl-switch ${checked ? 'checked' : ''}`;
            applyStyles(el, widget.styles?.main);

            const knob = document.createElement('div');
            knob.className = 'lvgl-switch-knob';
            const knobSize = widget.height - 4;
            knob.style.width = knobSize + 'px';
            knob.style.height = knobSize + 'px';
            knob.style.left = checked ? (widget.width - knobSize - 2) + 'px' : '2px';
            applyStyles(knob, widget.styles?.knob);

            el.appendChild(knob);
            return el;
        },

        checkbox(widget) {
            const el = document.createElement('div');
            el.className = `lvgl-widget lvgl-checkbox ${widget.properties.checked ? 'checked' : ''}`;
            applyStyles(el, widget.styles?.main);

            const box = document.createElement('div');
            box.className = 'lvgl-checkbox-box';
            applyStyles(box, widget.styles?.indicator);

            const lbl = document.createElement('span');
            lbl.textContent = widget.properties.text || 'Checkbox';

            el.appendChild(box);
            el.appendChild(lbl);
            return el;
        },

        dropdown(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-dropdown';
            applyStyles(el, widget.styles?.main);
            const opts = (widget.properties.options || '').split('\n').filter(s => s.trim());
            const idx = widget.properties.selected_index || 0;
            const text = document.createElement('span');
            text.textContent = opts[idx] || opts[0] || 'Select...';
            el.appendChild(text);
            return el;
        },

        roller(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-roller';
            applyStyles(el, widget.styles?.main);
            const opts = (widget.properties.options || '').split('\n').filter(s => s.trim());
            const idx = widget.properties.selected_index ?? 2;
            const visible = widget.properties.visible_row_count || 3;
            const half = Math.floor(visible / 2);

            for (let i = idx - half; i <= idx + half; i++) {
                const item = document.createElement('div');
                if (i === idx) {
                    item.className = 'lvgl-roller-selected';
                    applyStyles(item, widget.styles?.selected);
                }
                const realIdx = ((i % opts.length) + opts.length) % opts.length;
                item.textContent = opts[realIdx] || '';
                el.appendChild(item);
            }
            return el;
        },

        spinbox(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-spinbox';
            applyStyles(el, widget.styles?.main);

            const btnDec = document.createElement('div');
            btnDec.className = 'lvgl-spinbox-btn';
            btnDec.textContent = '-';

            const valDiv = document.createElement('div');
            valDiv.className = 'lvgl-spinbox-value';
            const val = widget.properties.value ?? 0;
            const digits = widget.properties.digit_count || 3;
            const decimals = widget.properties.decimal_count || 0;
            let formatted = val.toString().padStart(digits, ' ');
            if (decimals > 0) {
                const factor = Math.pow(10, decimals);
                formatted = (val / factor).toFixed(decimals);
            }
            valDiv.textContent = formatted;

            const btnInc = document.createElement('div');
            btnInc.className = 'lvgl-spinbox-btn';
            btnInc.textContent = '+';

            el.appendChild(btnDec);
            el.appendChild(valDiv);
            el.appendChild(btnInc);
            return el;
        },

        textarea(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-textarea';
            applyStyles(el, widget.styles?.main);
            const text = widget.properties.text || widget.properties.placeholder || '';
            el.textContent = text;
            if (!widget.properties.text && widget.properties.placeholder) {
                el.style.color = '#707090';
            }
            const cursor = document.createElement('span');
            cursor.className = 'lvgl-textarea-cursor';
            el.appendChild(cursor);
            return el;
        },

        image(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-image';
            applyStyles(el, widget.styles?.main);
            el.textContent = widget.properties.src || '[Image]';
            return el;
        },

        animimg(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-animimg';
            el.textContent = '[Anim Image]';
            return el;
        },

        led(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-led';
            const color = parseColor(widget.properties.color) || '#00ff00';
            const brightness = (widget.properties.brightness ?? 255) / 255;
            el.style.backgroundColor = color;
            el.style.color = color;
            el.style.opacity = brightness;
            applyStyles(el, widget.styles?.main);
            // LED widgets naturally glow — apply shadow from styles or auto-generate
            if (widget.styles?.main?.shadow_color) {
                // User-defined shadow
            } else if (brightness > 0.3) {
                // Auto glow based on LED color and brightness
                const glowSize = Math.round(8 * brightness);
                el.style.boxShadow = `0 0 ${glowSize}px ${Math.round(glowSize * 0.5)}px ${color}`;
            }
            return el;
        },

        line(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-line';
            const points = (widget.properties.points || '0,0\n100,100').split('\n')
                .map(p => p.trim().split(',').map(Number))
                .filter(p => p.length === 2 && !isNaN(p[0]) && !isNaN(p[1]));

            if (points.length >= 2) {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', `0 0 ${widget.width} ${widget.height}`);
                const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                polyline.setAttribute('points', points.map(p => p.join(',')).join(' '));
                polyline.setAttribute('fill', 'none');
                polyline.setAttribute('stroke', parseColor(widget.properties.line_color) || '#fff');
                polyline.setAttribute('stroke-width', widget.properties.line_width || 2);
                if (widget.properties.line_rounded) polyline.setAttribute('stroke-linecap', 'round');
                svg.appendChild(polyline);
                el.appendChild(svg);
            }
            return el;
        },

        meter(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-meter';
            const size = Math.min(widget.width, widget.height);
            const cx = size / 2, cy = size / 2;
            const r = size / 2 - 6;
            const tickCount = widget.properties.scale_ticks_count || 11;
            const tickLen = widget.properties.scale_ticks_length || 8;
            const tickWidth = widget.properties.scale_ticks_width || 2;
            const tickColor = parseColor(widget.properties.scale_ticks_color) || '#808080';
            const rangeFrom = widget.properties.scale_range_from ?? 0;
            const rangeTo = widget.properties.scale_range_to ?? 100;
            const angleRange = widget.properties.scale_angle_range || 270;
            const rotation = widget.properties.scale_rotation || 135;
            const val = widget.properties.indicator_value ?? 50;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

            // Ticks
            for (let i = 0; i < tickCount; i++) {
                const angle = rotation + (i / (tickCount - 1)) * angleRange;
                const rad = (angle - 90) * Math.PI / 180;
                const x1 = cx + (r - tickLen) * Math.cos(rad);
                const y1 = cy + (r - tickLen) * Math.sin(rad);
                const x2 = cx + r * Math.cos(rad);
                const y2 = cy + r * Math.sin(rad);
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', x1); line.setAttribute('y1', y1);
                line.setAttribute('x2', x2); line.setAttribute('y2', y2);
                line.setAttribute('stroke', tickColor);
                line.setAttribute('stroke-width', tickWidth);
                svg.appendChild(line);
            }

            // Needle
            const pct = (val - rangeFrom) / (rangeTo - rangeFrom);
            const needleAngle = rotation + pct * angleRange;
            const needleRad = (needleAngle - 90) * Math.PI / 180;
            const nx = cx + (r - tickLen - 4) * Math.cos(needleRad);
            const ny = cy + (r - tickLen - 4) * Math.sin(needleRad);
            const needle = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            needle.setAttribute('x1', cx); needle.setAttribute('y1', cy);
            needle.setAttribute('x2', nx); needle.setAttribute('y2', ny);
            needle.setAttribute('stroke', '#f44336');
            needle.setAttribute('stroke-width', 2);
            needle.setAttribute('stroke-linecap', 'round');
            svg.appendChild(needle);

            // Center dot
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
            dot.setAttribute('r', 4);
            dot.setAttribute('fill', '#f44336');
            svg.appendChild(dot);

            el.appendChild(svg);
            return el;
        },

        qrcode(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-qrcode';
            // Simple QR code placeholder (actual QR generation would need a library)
            const size = Math.min(widget.width, widget.height) - 8;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const dark = parseColor(widget.properties.dark_color) || '#000';
            const light = parseColor(widget.properties.light_color) || '#fff';
            ctx.fillStyle = light;
            ctx.fillRect(0, 0, size, size);
            // Draw a fake QR pattern
            ctx.fillStyle = dark;
            const cellSize = Math.floor(size / 21);
            const pattern = [
                [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],
                [1,0,0,0,0,0,1,0,0,1,0,1,0,0,1,0,0,0,0,0,1],
                [1,0,1,1,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,0,1],
                [1,0,1,1,1,0,1,0,0,1,0,1,0,0,1,0,1,1,1,0,1],
                [1,0,1,1,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,0,1],
                [1,0,0,0,0,0,1,0,0,1,0,1,0,0,1,0,0,0,0,0,1],
                [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],
            ];
            for (let row = 0; row < pattern.length; row++) {
                for (let col = 0; col < pattern[row].length; col++) {
                    if (pattern[row][col]) {
                        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
                    }
                }
            }
            // Bottom patterns
            for (let row = 0; row < 7; row++) {
                for (let col = 0; col < pattern[row].length; col++) {
                    if (row < pattern.length && pattern[row][col]) {
                        ctx.fillRect(col * cellSize, (14 + row) * cellSize, cellSize, cellSize);
                    }
                }
            }
            el.appendChild(canvas);
            return el;
        },

        spinner(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-spinner';
            const size = Math.min(widget.width, widget.height);
            const arcWidth = widget.properties.arc_width || 5;
            const arcLen = widget.properties.arc_length || 60;
            const color = parseColor(widget.properties.arc_color) || '#6c8cff';
            const r = (size - arcWidth) / 2;
            const cx = size / 2, cy = size / 2;

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
            svg.setAttribute('width', size);
            svg.setAttribute('height', size);

            // Background circle
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            bg.setAttribute('cx', cx); bg.setAttribute('cy', cy);
            bg.setAttribute('r', r);
            bg.setAttribute('fill', 'none');
            bg.setAttribute('stroke', '#404060');
            bg.setAttribute('stroke-width', arcWidth);
            svg.appendChild(bg);

            // Spinning arc
            const circumference = 2 * Math.PI * r;
            const dashLen = (arcLen / 360) * circumference;
            const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            arc.setAttribute('cx', cx); arc.setAttribute('cy', cy);
            arc.setAttribute('r', r);
            arc.setAttribute('fill', 'none');
            arc.setAttribute('stroke', color);
            arc.setAttribute('stroke-width', arcWidth);
            arc.setAttribute('stroke-linecap', 'round');
            arc.setAttribute('stroke-dasharray', `${dashLen} ${circumference - dashLen}`);
            svg.appendChild(arc);

            el.appendChild(svg);
            return el;
        },

        canvas(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-canvas';
            applyStyles(el, widget.styles?.main);
            return el;
        },

        buttonmatrix(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-btnmatrix';
            applyStyles(el, widget.styles?.main);

            const rowsText = widget.properties.rows || 'A,B,C\n1,2,3';
            const rows = rowsText.split('\n').filter(r => r.trim());
            const maxCols = Math.max(...rows.map(r => r.split(',').length));
            el.style.gridTemplateColumns = `repeat(${maxCols}, 1fr)`;
            el.style.gridTemplateRows = `repeat(${rows.length}, 1fr)`;

            for (const row of rows) {
                const btns = row.split(',').map(b => b.trim());
                for (const btn of btns) {
                    const btnEl = document.createElement('div');
                    btnEl.className = 'lvgl-btnmatrix-btn';
                    btnEl.textContent = btn;
                    el.appendChild(btnEl);
                }
            }
            return el;
        },

        tabview(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-tabview';
            applyStyles(el, widget.styles?.main);

            const tabs = (widget.properties.tab_labels || 'Tab 1\nTab 2').split('\n').filter(s => s.trim());
            const selectedTab = widget.properties.selected_tab || 0;

            const tabBar = document.createElement('div');
            tabBar.className = 'lvgl-tabview-tabs';
            tabs.forEach((tab, i) => {
                const tabEl = document.createElement('div');
                tabEl.className = `lvgl-tabview-tab ${i === selectedTab ? 'active' : ''}`;
                tabEl.textContent = tab;
                tabBar.appendChild(tabEl);
            });

            const content = document.createElement('div');
            content.className = 'lvgl-tabview-content';

            el.appendChild(tabBar);
            el.appendChild(content);
            return el;
        },

        tileview(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-tileview';
            el.textContent = '[Tileview]';
            return el;
        },

        keyboard(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-keyboard';
            applyStyles(el, widget.styles?.main);

            const keys = widget.properties.mode === 'NUMBER'
                ? ['1','2','3','4','5','6','7','8','9','0']
                : ['q','w','e','r','t','y','u','i','o','p','a','s','d','f','g','h','j','k','l',';','z','x','c','v','b','n','m',',','.','/'];

            for (const key of keys) {
                const keyEl = document.createElement('div');
                keyEl.className = 'lvgl-key';
                keyEl.textContent = key;
                el.appendChild(keyEl);
            }
            return el;
        },

        msgbox(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-msgbox';
            applyStyles(el, widget.styles?.main);

            const title = document.createElement('div');
            title.className = 'lvgl-msgbox-title';
            title.textContent = widget.properties.title || 'Title';
            el.appendChild(title);

            const body = document.createElement('div');
            body.className = 'lvgl-msgbox-text';
            body.textContent = widget.properties.body || 'Message';
            el.appendChild(body);

            const btns = document.createElement('div');
            btns.className = 'lvgl-msgbox-btns';
            const btnLabels = (widget.properties.buttons || 'OK').split('\n').filter(s => s.trim());
            for (const label of btnLabels) {
                const btn = document.createElement('div');
                btn.className = 'lvgl-msgbox-btn';
                btn.textContent = label;
                btns.appendChild(btn);
            }
            el.appendChild(btns);
            return el;
        },

        obj(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-obj';
            applyStyles(el, widget.styles?.main);
            return el;
        },
    };

    // ---- Public API ----
    return {
        parseColor,
        parseOpacity,

        /**
         * Render a widget instance into an HTML element.
         * @param {Object} widget - Widget instance with type, properties, styles, width, height
         * @returns {HTMLElement} - The rendered widget element
         */
        render(widget) {
            const renderFn = renderers[widget.type];
            if (!renderFn) {
                const el = document.createElement('div');
                el.className = 'lvgl-widget';
                el.textContent = `[${widget.type}]`;
                el.style.background = '#303050';
                el.style.border = '1px dashed #505070';
                el.style.display = 'flex';
                el.style.alignItems = 'center';
                el.style.justifyContent = 'center';
                el.style.color = '#707090';
                el.style.fontSize = '11px';
                return el;
            }
            return renderFn(widget);
        },

        /**
         * Check if widget dimensions indicate vertical orientation.
         */
        isVertical,
    };
})();
