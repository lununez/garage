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
     * Supports: 0-255 int, 0-100%, TRANSP, COVER, percentage strings
     */
    function parseOpacity(val) {
        if (val == null || val === '') return null;
        if (typeof val === 'string') {
            const lower = val.toLowerCase();
            if (lower === 'transp') return 0;
            if (lower === 'cover') return 1;
            if (lower.endsWith('%')) return parseFloat(lower) / 100;
            return parseFloat(lower) / 255;
        }
        if (typeof val === 'number') {
            if (val > 1 && val <= 255) return val / 255;
            return val;
        }
        return null;
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
                // Apply opacity to background only
                s.backgroundColor = bg;
                s.opacity = bgOpa;
            }
        }

        const opa = parseOpacity(styles.opa);
        if (opa != null) s.opacity = opa;

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
            s.boxShadow = `${sox}px ${soy}px ${sw}px ${spread}px ${sc}`;
        }

        if (styles.outline_color) {
            const oc = parseColor(styles.outline_color);
            const ow = styles.outline_width || 1;
            s.outline = `${ow}px solid ${oc}`;
            if (styles.outline_pad) s.outlineOffset = styles.outline_pad + 'px';
        }
    }

    /**
     * Determine if a slider should be vertical based on its dimensions.
     */
    function isVertical(widget) {
        return widget.height > widget.width;
    }

    // ---- Widget Render Functions ----
    // Each returns an HTML element representing the widget's visual appearance.

    const renderers = {

        label(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-label';
            el.textContent = widget.properties.text || 'Label';
            applyStyles(el, widget.styles?.main);
            const tc = parseColor(widget.styles?.main?.text_color);
            if (tc) el.style.color = tc;
            return el;
        },

        button(widget) {
            const el = document.createElement('div');
            el.className = 'lvgl-widget lvgl-button';
            applyStyles(el, widget.styles?.main);
            // Render children labels
            if (widget.children && widget.children.length > 0) {
                const childLabel = widget.children.find(c => c.type === 'label');
                if (childLabel) {
                    el.textContent = childLabel.properties?.text || '';
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

            const track = document.createElement('div');
            track.className = 'lvgl-slider-track';
            applyStyles(track, widget.styles?.main);

            const indicator = document.createElement('div');
            indicator.className = 'lvgl-slider-indicator';
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
            track.appendChild(indicator);

            // Knob
            const knobStyle = widget.properties.knob_style || 'circle';
            if (knobStyle !== 'none') {
                const knob = document.createElement('div');
                knob.className = 'lvgl-slider-knob';

                if (knobStyle === 'bar') {
                    knob.classList.add('knob-bar');
                    const kw = widget.properties.knob_width || (vertical ? '80%' : 4);
                    const kh = widget.properties.knob_height || (vertical ? 4 : '80%');
                    knob.style.width = typeof kw === 'number' ? kw + 'px' : kw;
                    knob.style.height = typeof kh === 'number' ? kh + 'px' : kh;
                } else if (knobStyle === 'image') {
                    knob.classList.add('knob-image');
                    if (widget.properties.knob_image) {
                        knob.style.backgroundImage = `url(${widget.properties.knob_image})`;
                    }
                    const kw = widget.properties.knob_width || 24;
                    const kh = widget.properties.knob_height || 24;
                    knob.style.width = typeof kw === 'number' ? kw + 'px' : kw;
                    knob.style.height = typeof kh === 'number' ? kh + 'px' : kh;
                } else {
                    // circle (default)
                    const kSize = widget.properties.knob_width || (vertical ? Math.min(widget.width * 1.5, 24) : Math.min(widget.height * 1.5, 24));
                    knob.style.width = kSize + 'px';
                    knob.style.height = kSize + 'px';
                }

                applyStyles(knob, widget.styles?.knob);

                // Position knob
                if (vertical) {
                    const trackH = widget.height;
                    const knobPos = trackH - (pct / 100 * trackH);
                    knob.style.top = knobPos + 'px';
                } else {
                    const trackW = widget.width;
                    const knobPos = pct / 100 * trackW;
                    knob.style.left = knobPos + 'px';
                }

                track.appendChild(knob);
            }

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
            el.textContent = '[Canvas]';
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
