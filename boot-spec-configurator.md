# R.M. Williams — Boot Configurator Developer Brief

**Purpose:** Pre-sales demo for April 1, 2026 playback session
**Audience:** Internal dev / partner dev building the demo
**Store:** RM Williams Shopify Plus demo store (Liquid / Online Store 2.0)
**Last updated:** March 25, 2026

---

## 1. Objective

Build a "Design Your Perfect Boot" configurator on the Liquid storefront that lets a user step through the RM Williams Made to Order process, see a visual preview of their boot update with each selection, and add the configured boot to cart with all choices captured as line item properties.

This is a DEMO build — not production. It needs to look polished (luxury brand, ex-Gucci CCO in the room) but doesn't need real inventory, 3D rendering, or backend fulfilment routing. The benchmark cited by the merchant is the Yeti engraving experience — visual preview of personalisation on PDP.

**What success looks like:** A presenter walks through the configurator live, selects options at each step, the boot illustration updates visually, the price adjusts, and the configured boot lands in cart with a full summary of choices.

---

## 2. The Real RM Williams MTO Process (What We're Mimicking)

Source: https://www.rmwilliams.com.au/made-to-order-options/

RM Williams offers 4,000,000+ boot variations across 8 configuration steps in three phases. The service is currently paused (supply chain) but confirmed as a MUST HAVE for the future platform.

### Phase: BUILD
| Step | Options | Notes |
|------|---------|-------|
| 1. Toe Shape | 6 shapes | Visual selector — each shape is distinct |
| 2. Heel | 5 styles (flat, flat tapered, block, Cuban, +1) | Height/profile differences |
| 3. Sole | 5 types (sewn welt leather, brass-screwed, rubber, +2) | Functional + aesthetic choice |
| 4. Width | 9 widths | Fit selection — less visual, more data |
| 5. Length | Sizes 1–17 | Standard sizing — varies by style |

### Phase: CUSTOMISE
| Step | Options | Notes |
|------|---------|-------|
| 6. Leather Type | Yearling, Kangaroo, Exotic (Ostrich, Crocodile) | Material category first |
| 7. Colour | 20+ colours, includes two-tone hand-burnished | Colour depends on leather type |

### Phase: PERSONALISE
| Step | Options | Notes |
|------|---------|-------|
| 8. Finishing | Tug colour, elastic colour, edge stain, engraving | Multiple sub-selections in one step |

---

## 3. Demo Scope — Standard Boot Prototype

For the demo, we are building a configurator for a SINGLE standard boot style (e.g. Craftsman or Comfort Craftsman). We are NOT building all 4M+ variations.

### Simplified step flow for demo:

| Step | Demo Options (reduced set) | Visual Update? |
|------|---------------------------|----------------|
| 1. Toe Shape | 3 options (round, chisel, square) | Yes — swap toe illustration |
| 2. Heel | 3 options (flat, block, Cuban) | Yes — swap heel illustration |
| 3. Sole | 3 options (leather, rubber, brass-screwed) | Yes — swap sole illustration |
| 4. Leather & Colour | 4 options (chestnut yearling, black yearling, tobacco suede, cognac kangaroo) | Yes — swap body colour/texture |
| 5. Finishing | Tug colour (3), elastic colour (3), engraving (free text) | Yes — swap tug/elastic colour, show engraving text |

**Dropped for demo:** Width, length (size) — these are functional fit choices, not visual. Can be standard dropdowns on the final "Add to Cart" step if needed.

---

## 4. Visual Preview Approach — Layered Illustration

### Concept: Composite boot image built from layered SVG/PNG elements

The boot preview is NOT a photograph. It is a **sketch-style illustration** composed of separate elements that stack to form the complete boot. Each configuration choice swaps the relevant layer.

### Layer stack (bottom to top):
```
┌─────────────────────────┐
│  Layer 5: Finishing      │  ← Tug + elastic colour overlays + engraving text
│  Layer 4: Body colour    │  ← Leather colour/texture fill or tinted overlay
│  Layer 3: Sole           │  ← Sole shape illustration
│  Layer 2: Heel           │  ← Heel shape illustration
│  Layer 1: Toe shape      │  ← Toe shape illustration
│  Layer 0: Base outline   │  ← Boot silhouette (constant)
└─────────────────────────┘
```

### Asset generation approach:
- Use an AI image generation tool (e.g. Midjourney, DALL-E) to create individual boot element illustrations in a consistent sketch/line-drawing style
- Each element must be created on a transparent background (PNG) at a consistent canvas size so they align when stacked
- The base outline stays constant — only the component layers swap
- Colour changes can be handled via CSS filters/tinting on the body layer (avoids needing 20+ colour versions of every element)

### Asset naming convention:
```
/assets/configurator/
├── base-outline.png
├── toe-round.png
├── toe-chisel.png
├── toe-square.png
├── heel-flat.png
├── heel-block.png
├── heel-cuban.png
├── sole-leather.png
├── sole-rubber.png
├── sole-brass.png
├── tug-brown.png
├── tug-black.png
├── tug-tan.png
├── elastic-brown.png
├── elastic-black.png
├── elastic-tan.png
```

### Canvas specs:
- **Dimensions:** 600×800px (portrait boot orientation)
- **Format:** PNG with transparency
- **Style:** Hand-drawn/sketch aesthetic consistent with RM Williams heritage brand (think: artisan, craft, not clinical)
- **Alignment:** All elements must share the same anchor point so they overlay correctly

### Colour/texture handling:
For the leather colour step, rather than creating separate assets per colour, use CSS to tint a single body layer:
```css
.configurator-layer--body {
  filter: sepia(1) saturate(2) hue-rotate(Xdeg) brightness(Y);
}
```
Map each leather/colour option to a CSS filter preset. This keeps asset count manageable.

---

## 5. Technical Architecture

### 5.1 Product Data Model

**Single product in Shopify:** "Build Your Boot — Craftsman"
- **One default variant** (no size/width variants needed for demo)
- **Base price:** Set to starting price (e.g. $795)

**Metafield: `custom.configurator_config` (JSON)**

This metafield on the product defines the entire configuration schema:

```json
{
  "steps": [
    {
      "id": "toe",
      "title": "Toe Shape",
      "phase": "Build",
      "options": [
        { "id": "round", "label": "Round Toe", "description": "Classic RM Williams profile", "image_layer": "toe-round.png", "price_adjust": 0 },
        { "id": "chisel", "label": "Chisel Toe", "description": "Angular, contemporary", "image_layer": "toe-chisel.png", "price_adjust": 0 },
        { "id": "square", "label": "Square Toe", "description": "Bold, structured", "image_layer": "toe-square.png", "price_adjust": 0 }
      ]
    },
    {
      "id": "heel",
      "title": "Heel",
      "phase": "Build",
      "options": [
        { "id": "flat", "label": "Flat Heel", "description": "Low-profile everyday wear", "image_layer": "heel-flat.png", "price_adjust": 0 },
        { "id": "block", "label": "Block Heel", "description": "Classic dress boot", "image_layer": "heel-block.png", "price_adjust": 0 },
        { "id": "cuban", "label": "Cuban Heel", "description": "Elevated statement", "image_layer": "heel-cuban.png", "price_adjust": 50 }
      ]
    },
    {
      "id": "sole",
      "title": "Sole",
      "phase": "Build",
      "options": [
        { "id": "leather", "label": "Sewn Welt Leather", "description": "Traditional craftsmanship", "image_layer": "sole-leather.png", "price_adjust": 0 },
        { "id": "rubber", "label": "Comfort Rubber", "description": "All-day wearability", "image_layer": "sole-rubber.png", "price_adjust": 0 },
        { "id": "brass", "label": "Brass-Screwed", "description": "Heritage durability", "image_layer": "sole-brass.png", "price_adjust": 30 }
      ]
    },
    {
      "id": "leather_colour",
      "title": "Leather & Colour",
      "phase": "Customise",
      "options": [
        { "id": "chestnut_yearling", "label": "Chestnut Yearling", "css_filter": "sepia(0.4) saturate(1.5) hue-rotate(10deg)", "price_adjust": 0 },
        { "id": "black_yearling", "label": "Black Yearling", "css_filter": "brightness(0.15)", "price_adjust": 0 },
        { "id": "tobacco_suede", "label": "Tobacco Suede", "css_filter": "sepia(0.6) saturate(1.2) hue-rotate(-10deg) brightness(1.1)", "price_adjust": 25 },
        { "id": "cognac_kangaroo", "label": "Cognac Kangaroo", "css_filter": "sepia(0.5) saturate(1.8) hue-rotate(20deg)", "price_adjust": 75 }
      ]
    },
    {
      "id": "finishing",
      "title": "Finishing Touches",
      "phase": "Personalise",
      "sub_options": [
        {
          "id": "tug_colour",
          "label": "Tug Colour",
          "options": [
            { "id": "brown", "label": "Brown", "image_layer": "tug-brown.png" },
            { "id": "black", "label": "Black", "image_layer": "tug-black.png" },
            { "id": "tan", "label": "Tan", "image_layer": "tug-tan.png" }
          ]
        },
        {
          "id": "elastic_colour",
          "label": "Elastic Colour",
          "options": [
            { "id": "brown", "label": "Brown", "image_layer": "elastic-brown.png" },
            { "id": "black", "label": "Black", "image_layer": "elastic-black.png" },
            { "id": "tan", "label": "Tan", "image_layer": "elastic-tan.png" }
          ]
        },
        {
          "id": "engraving",
          "label": "Sole Engraving",
          "type": "text",
          "max_length": 20,
          "placeholder": "e.g. your initials"
        }
      ]
    }
  ]
}
```

### 5.2 Theme Implementation

**New section:** `sections/configurator.liquid`

This is an Online Store 2.0 section assigned to the "Build Your Boot" product template.

**Structure:**
```
┌──────────────────────────────────────────────────┐
│  HEADER: "Design Your Perfect Boot"              │
│  Phase indicator: BUILD → CUSTOMISE → PERSONALISE│
├────────────────────┬─────────────────────────────┤
│                    │                             │
│  OPTION PANEL      │  BOOT PREVIEW              │
│  (left 40%)        │  (right 60%)               │
│                    │                             │
│  Step title        │  ┌─────────────────────┐   │
│  Step description  │  │ Layered boot image  │   │
│  Option cards      │  │ (CSS positioned     │   │
│  (radio select)    │  │  PNG layers)        │   │
│                    │  └─────────────────────┘   │
│                    │                             │
│                    │  Running total: $XXX        │
├────────────────────┴─────────────────────────────┤
│  ← Previous                        Next Step →  │
│                                                  │
│  [ADD TO CART — $XXX]  (visible on final step)   │
└──────────────────────────────────────────────────┘
```

**Key Liquid responsibilities:**
- Read `product.metafields.custom.configurator_config` and parse the JSON
- Render the step navigation, option cards, and preview container
- Output all configuration data as a `<script type="application/json">` block for JS to consume

**Key JavaScript responsibilities (vanilla JS, no framework):**
- Step navigation (next/prev) with animation
- Option selection → update active state + swap image layer
- Leather colour selection → apply CSS filter to body layer
- Engraving text → render on preview (CSS positioned text overlay)
- Running price calculation (base price + sum of all `price_adjust` values)
- Add to cart via AJAX Cart API with line item properties

### 5.3 Add to Cart Payload

When the user clicks "Add to Cart", POST to `/cart/add.js`:

```javascript
fetch('/cart/add.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: VARIANT_ID,  // single default variant
    quantity: 1,
    properties: {
      'Toe Shape': 'Chisel Toe',
      'Heel': 'Cuban Heel',
      'Sole': 'Brass-Screwed',
      'Leather': 'Cognac Kangaroo',
      'Tug Colour': 'Tan',
      'Elastic Colour': 'Brown',
      'Engraving': 'S.D.',
      '_configurator_price': '950',  // underscore = hidden from customer
      '_configuration_id': 'cfg_abc123'  // for order routing
    }
  })
});
```

Line item properties display in cart, checkout, and order confirmation — giving the merchant team full visibility of the configured boot.

### 5.4 Cart Display

In `snippets/cart-item.liquid` (or equivalent), render the configuration summary:

```liquid
{% if item.properties %}
  <div class="configurator-summary">
    {% for property in item.properties %}
      {% unless property.first contains '_' %}
        <div class="config-line">
          <span class="config-label">{{ property.first }}:</span>
          <span class="config-value">{{ property.last }}</span>
        </div>
      {% endunless %}
    {% endfor %}
  </div>
{% endif %}
```

---

## 6. Files to Create

| File | Purpose |
|------|---------|
| `sections/configurator.liquid` | Main configurator section (Liquid + HTML structure) |
| `assets/configurator.js` | Step navigation, option selection, preview updates, cart add |
| `assets/configurator.css` | Layout, animations, option card styling, preview positioning |
| `assets/configurator/*.png` | All boot element layers (see Section 4 for list) |
| `templates/product.configurator.json` | Product template that includes the configurator section |

**Existing files to modify:**
| File | Change |
|------|--------|
| `snippets/cart-item.liquid` (or equivalent) | Add line item properties display |

---

## 7. Out of Scope (Do NOT Build)

- 3D rendering or WebGL (future state — Threekit/Zakeke)
- Real inventory checks against configuration combinations
- Cart Transform Function for dynamic pricing (JS-side display is sufficient for demo)
- Shopify Flow routing of MTO orders to specific DCs
- Width/length (size) selection UI
- Multiple boot styles (Craftsman only)
- Mobile-optimised responsive layout (demo is presented on desktop)
- Production-grade error handling or edge cases

---

## 8. Acceptance Criteria

| # | Criteria | Required |
|---|---------|----------|
| 1 | User can navigate through all 5 steps sequentially | Yes |
| 2 | Selecting an option visually updates the boot preview | Yes |
| 3 | Leather/colour selection changes the boot colour via CSS | Yes |
| 4 | Engraving text input renders on the boot preview | Yes |
| 5 | Running price total updates with each selection | Yes |
| 6 | "Add to Cart" captures all selections as line item properties | Yes |
| 7 | Cart displays configuration summary per line item | Yes |
| 8 | Phase indicator (Build → Customise → Personalise) tracks progress | Yes |
| 9 | Presentation quality — luxury aesthetic, smooth transitions | Yes |
| 10 | Works on Chrome desktop at 1920×1080 (demo resolution) | Yes |

---

## 9. Design Direction

- **Aesthetic:** Heritage craft, hand-drawn sketch style — NOT clinical/corporate
- **Palette:** Warm neutrals, RM Williams brand tones (deep brown, sand, cream)
- **Typography:** Serif headings (brand-aligned), clean sans body
- **Transitions:** Smooth fade/slide between steps (300ms ease)
- **Option cards:** Large, tappable, with thumbnail illustrations — not dropdowns
- **Preview:** Dominant right-side placement, boot illustration at ~500px height

---

## 10. References

- **RM Williams MTO page:** https://www.rmwilliams.com.au/made-to-order-options/made_to_order_options.html
- **Yeti engraving benchmark:** Personalisation on PDP with visual preview (cited by Quaetapo as the standard)
- **SENTRAL — Nick Scali configurator:** Furniture configurator using metafield JSON schema + line item properties (similar architecture)
- **Demo use cases doc:** Track 3 spec in `demo-use-cases.md`

---

*Brief prepared by Shannon Dutton, Solutions Engineer*
*For questions: Slack #rm-williams or direct*
