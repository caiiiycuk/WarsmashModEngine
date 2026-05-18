package com.etheller.warsmash.html;

import java.util.HashMap;
import java.util.Map;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.g2d.BitmapFont;
import com.etheller.warsmash.datasources.DataSource;
import com.etheller.warsmash.parsers.fdf.DynamicFontGeneratorHolder;
import com.etheller.warsmash.parsers.fdf.FontGeneratorHolder;
import com.etheller.warsmash.parsers.fdf.FontParameter;
import com.etheller.warsmash.units.Element;

/**
 * Web implementation for {@link DynamicFontGeneratorHolder}. Uses one bundled
 * bitmap font for every logical font name and size. The atlas includes Latin and
 * Cyrillic glyphs so localized MPQ strings remain readable even though the web
 * build cannot use libgdx-freetype at runtime.
 *
 * <p>This keeps the web path intentionally simple. It is not yet a per-skin,
 * per-size recreation of WC3's TTFs, but it avoids missing-glyph boxes for
 * localized UI text without pulling FreeType into the TeaVM reachability graph.
 *
 * <p>Crucially, this file contains zero {@code gdx.graphics.g2d.freetype.*}
 * references, so installing it on web keeps FreeType entirely off the
 * reachability graph.
 */
final class WebDynamicFontGeneratorHolder implements DynamicFontGeneratorHolder {
	private final DataSource dataSource;
	private final Element skin;
	private final Map<String, FontGeneratorHolder> fontNameToGenerator = new HashMap<>();

	WebDynamicFontGeneratorHolder(final DataSource dataSource, final Element skin) {
		this.dataSource = dataSource;
		this.skin = skin;
	}

	@Override
	public FontGeneratorHolder getFontGenerator(final String font) {
		FontGeneratorHolder holder = this.fontNameToGenerator.get(font);
		if (holder == null) {
			holder = new BundledHolder();
			this.fontNameToGenerator.put(font, holder);
		}
		return holder;
	}

	@Override
	public void dispose() {
		for (final FontGeneratorHolder holder : this.fontNameToGenerator.values()) {
			holder.dispose();
		}
		this.fontNameToGenerator.clear();
	}

	/**
	 * Uses a single pre-baked bitmap font for every request. The
	 * {@code parameter.size} is currently ignored, matching the previous web
	 * behavior; the only change is that the bundled atlas now contains Cyrillic.
	 */
	private static final class BundledHolder implements FontGeneratorHolder {
		private BitmapFont bundledFont;

		@Override
		public BitmapFont generateFont(final FontParameter parameter) {
			if (this.bundledFont == null) {
				this.bundledFont = new BitmapFont(Gdx.files.internal("fonts/web-cyrillic.fnt"));
			}
			return this.bundledFont;
		}

		@Override
		public void dispose() {
			if (this.bundledFont != null) {
				this.bundledFont.dispose();
				this.bundledFont = null;
			}
		}
	}
}
