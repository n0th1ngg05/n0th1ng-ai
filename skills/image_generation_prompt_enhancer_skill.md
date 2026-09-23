# Image Generation Prompt Enhancement Skill

## Purpose

Transform a user's image-generation request into a clear, detailed, model-agnostic prompt suitable for local and hosted image-generation models.

This skill is **not tied to FLUX.2 Klein**. It should work across different image models, including photorealistic, artistic, anime, illustration, diffusion, transformer-based, and specialized generation models.

The central principle is:

> **Enhance the user's idea without changing the user's idea.**

The enhancer adds useful visual specificity while preserving the user's requested subject, action, appearance, environment, composition, mood, style, and other explicit requirements.

---

# 1. Core Behavior

When a user provides an image prompt:

1. Parse the request into explicit visual requirements.
2. Preserve every meaningful requirement.
3. Infer only reasonable details that help render the requested scene.
4. Add useful specificity around:
   - subject details
   - pose/action
   - composition
   - environment
   - lighting
   - camera perspective
   - materials/textures
   - atmosphere
   - depth
   - color
   - visual style
5. Keep the resulting scene coherent.
6. Do not replace the user's concept with a different concept.
7. Do not remove requested elements because they seem secondary.
8. Do not introduce unrelated subjects, objects, locations, or narratives.
9. Do not blindly append generic quality keywords.
10. Adapt terminology to the apparent target model when model information is available.

---

# 2. Intent Preservation

The user's explicit request is authoritative.

The enhancer must preserve:

- subject
- number of major subjects
- identity/type
- approximate age when supplied
- gender when supplied
- appearance
- clothing
- colors
- pose
- action
- expression
- environment
- location
- weather
- time of day
- requested objects
- requested background elements
- requested composition
- requested style
- requested mood
- requested camera perspective
- requested artistic medium

### Example

User:

> red Porsche 911 at night with rain and headlights

The enhancement must still contain:

- Porsche 911
- red/cherry-red color
- night
- rain
- headlights

It may add:

- wet asphalt
- reflections
- urban lighting
- realistic raindrops
- camera angle
- automotive photography characteristics

It must not turn the scene into a Ferrari, daytime scene, dry road, or unrelated location.

---

# 3. Enhancement vs. Replacement

## Enhancement

Good:

> A cherry-red Porsche 911 at night in heavy rain, glossy bodywork covered with realistic droplets, illuminated LED headlights reflecting across wet asphalt...

The original concept remains intact.

## Replacement

Bad:

> A futuristic red supercar racing through a neon cyberpunk city...

This changes the vehicle and introduces a different visual concept.

The enhancer must avoid replacement behavior.

---

# 4. Model-Agnostic Prompting

Do not assume every model interprets prompts identically.

When the user specifies a model, adapt the prompt to that model's known prompting characteristics.

When no model is specified:

- use natural descriptive language
- avoid model-specific syntax
- avoid excessive token weighting
- avoid unnecessary special tokens
- keep the prompt portable across models

Do not claim that a prompt is optimized for a specific architecture unless the model is known.

### If the user specifies a model

Consider its conventions:

- natural-language prompting
- tag-based prompting
- weighted prompts
- negative prompts
- style tokens
- character tags
- image-to-image conditioning
- control/reference image requirements

Do not add syntax that the model does not support.

---

# 5. Prompt Structure

A strong general image prompt can follow this conceptual structure:

```text
[Subject] + [Action/Pose] + [Appearance] + [Environment] +
[Composition] + [Lighting] + [Materials/Textures] +
[Atmosphere] + [Camera/Optics] + [Color/Style] + [Rendering characteristics]
```

Not every prompt needs every component.

Only include details that improve the requested image.

---

# 6. Subject Description

Clearly establish the primary subject first.

Examples:

### Person

> Professional portrait of a young woman with long blonde hair wearing a white formal shirt...

### Vehicle

> Professional automotive photograph of a pristine cherry-red Porsche 911...

### Wildlife

> Photorealistic wildlife scene featuring a majestic red deer...

### Architecture

> Architectural photograph of a modern concrete-and-glass residence...

### Food

> Editorial food photograph of a freshly baked Neapolitan pizza...

### Product

> Commercial product photograph of a premium mechanical wristwatch...

The primary subject should remain visually dominant unless the user explicitly requests an environmental composition.

---

# 7. People / Portrait Photography

For people, consider:

- approximate age
- gender
- hairstyle
- hair color
- facial characteristics
- skin texture
- clothing
- accessories
- pose
- expression
- gaze direction
- body orientation
- hand placement
- environment
- lighting
- lens
- depth of field
- photographic style

### Useful photographic language

```text
professional portrait photography
natural skin texture
realistic facial features
sharp focus on the eyes
natural hair strands
subtle makeup
soft directional light
85mm portrait lens
shallow depth of field
natural background bokeh
realistic skin tones
subtle film grain
```

Do not introduce unnecessary beauty retouching if realism is requested.

### Important preservation rule

If the user specifies:

> blonde woman wearing brown sunglasses and a white formal shirt

Do not change:

- blonde hair
- sunglasses
- brown tint
- white shirt

---

# 8. Vehicles / Automotive

For cars, motorcycles, trucks, aircraft, boats, and similar subjects, consider:

- exact model
- generation when supplied
- body color
- paint finish
- body panels
- wheels
- tires
- headlights
- windows
- materials
- carbon fiber
- chrome
- road/surface
- motion
- camera position
- reflections
- lighting
- environment

### Automotive camera choices

Use according to the requested scene:

- 24–35mm for dramatic environmental automotive shots
- 35–50mm for natural vehicle perspective
- 50–85mm for compressed/detail-oriented shots
- low-angle three-quarter front
- low-angle rear tracking shot
- side tracking shot
- front-on composition
- aerial perspective

### Automotive realism

Useful details:

```text
realistic body proportions
accurate wheel geometry
natural paint reflections
detailed tire tread
realistic glass
precise panel contours
realistic metallic surfaces
wet-road reflections
headlight illumination
subtle motion in the background
```

Do not add:

```text
warped wheels
incorrect proportions
fake reflections
floating vehicle
duplicate vehicle
```

to the positive prompt.

---

# 9. Wildlife / Animals

For wildlife, prioritize natural behavior and ecological coherence.

Consider:

- species
- age/sex when requested
- fur/feathers/scales
- anatomy
- natural behavior
- habitat
- vegetation
- other animals
- water
- weather
- season
- time of day
- natural light
- environmental depth

### Wildlife photography

Useful details:

```text
professional wildlife photography
natural animal behavior
detailed fur
individual feathers
realistic eyes
natural habitat
telephoto perspective
natural atmospheric depth
soft morning light
realistic environmental interaction
```

For wildlife scenes containing many elements, maintain ecological plausibility.

Example:

> deer + lake + fish + birds + forest + stream + mountains

should become one coherent ecosystem rather than unrelated objects scattered into a scene.

---

# 10. Nature / Landscape

Consider:

- foreground
- middle ground
- background
- terrain
- vegetation
- water
- mountains
- sky
- weather
- season
- time of day
- atmospheric perspective
- light direction
- reflections
- scale

Use:

```text
layered foreground, middle ground and background
natural atmospheric perspective
realistic terrain
soft environmental haze
natural sunlight
detailed vegetation
realistic water reflections
```

For landscapes, avoid excessive shallow depth of field when the user wants the entire environment visible.

---

# 11. Architecture / Interiors

Consider:

- architectural style
- building type
- materials
- geometry
- facade
- windows
- doors
- interior layout
- furniture
- lighting
- surrounding environment
- perspective
- symmetry
- scale

Useful photography terms:

```text
architectural photography
straight vertical lines
balanced perspective
wide-angle lens
natural interior lighting
realistic material textures
accurate proportions
clean geometric composition
```

Avoid unnecessary fisheye distortion unless requested.

---

# 12. Product Photography

For products, prioritize accuracy and clarity.

Consider:

- exact product type
- color
- material
- surface finish
- branding if requested
- orientation
- background
- lighting
- reflections
- shadows
- camera angle

Useful terms:

```text
commercial product photography
clean studio lighting
precise product geometry
controlled reflections
sharp product edges
realistic materials
soft contact shadow
minimal background
```

Do not invent branding, logos, or product features that were not requested.

---

# 13. Fashion / Editorial

Consider:

- garment
- fabric
- color
- fit
- accessories
- pose
- styling
- location
- lighting
- editorial mood
- camera perspective

Useful terms:

```text
editorial fashion photography
luxury styling
realistic fabric texture
natural garment folds
professional studio lighting
cinematic composition
subtle film grain
```

Preserve the exact clothing requested.

---

# 14. Food Photography

Consider:

- exact dish
- ingredients visible
- plating
- texture
- steam
- surface
- utensils
- table environment
- lighting
- camera angle
- depth of field

Examples:

```text
editorial food photography
natural food texture
appetizing presentation
soft directional window light
realistic highlights
subtle steam
shallow depth of field
```

Do not add ingredients that contradict dietary or recipe requirements.

---

# 15. Architecture / Cityscape / Urban Scenes

Consider:

- city type
- buildings
- streets
- vehicles
- pedestrians
- signs
- weather
- time
- lighting
- reflections
- perspective

Useful terms:

```text
urban photography
realistic city scale
architectural detail
wet pavement reflections
distant traffic
natural atmospheric haze
cinematic street lighting
```

Do not add a cyberpunk aesthetic unless requested.

---

# 16. Sci-Fi / Futuristic

For speculative scenes, establish:

- technology
- architecture
- vehicles
- environment
- lighting
- materials
- atmosphere
- scale

Maintain internal consistency.

If the user asks for:

> futuristic city with flying vehicles

you can add:

> layered megastructures, illuminated transit corridors, atmospheric haze, reflective materials

but should not automatically turn it into:

> cyberpunk neon dystopia

unless requested.

---

# 17. Fantasy

Consider:

- world type
- creatures
- architecture
- clothing
- magic
- landscape
- atmosphere
- lighting
- color palette

Preserve the user's requested fantasy aesthetic.

Do not automatically add:

- dragons
- castles
- magic particles
- glowing runes

unless compatible with the request.

---

# 18. Anime / Illustration / Stylized Art

When the user explicitly requests a stylized medium, do not force photorealism.

Respect:

- anime
- manga
- cel shading
- watercolor
- oil painting
- concept art
- comic book
- pixel art
- 3D stylization
- vector illustration
- low-poly
- painterly styles

For stylized prompts, describe the visual language appropriate to the medium.

Example:

> watercolor landscape

can be enhanced with:

```text
delicate paper texture
transparent washes
soft pigment bleeding
subtle brushwork
layered watercolor edges
```

rather than:

```text
photorealistic skin texture, 85mm lens
```

unless the user specifically requests a mixed style.

---

# 19. Horror / Dark Atmosphere

For dark scenes, consider:

- lighting direction
- shadow density
- environmental decay
- fog
- weather
- color palette
- composition
- visual tension

Avoid gratuitous graphic elements unless explicitly requested and permitted.

---

# 20. Historical / Period Scenes

Preserve the requested historical period.

Consider:

- architecture
- clothing
- vehicles
- tools
- materials
- lighting
- environment
- social setting

Do not introduce modern objects unless the user requests an anachronistic scene.

---

# 21. Macro / Close-Up Photography

For macro scenes, emphasize:

- extremely fine texture
- microscopic surface detail
- controlled focus
- realistic depth of field
- specular highlights
- natural scale cues

Examples:

- insect wings
- flower pollen
- water droplets
- fabric fibers
- mechanical components

---

# 22. Underwater Scenes

Consider:

- water clarity
- caustic light
- suspended particles
- bubbles
- refraction
- color attenuation
- marine life
- depth

Avoid adding ordinary atmospheric haze that would make no physical sense underwater.

---

# 23. Night Scenes

For nighttime images, consider:

- practical light sources
- moonlight
- streetlights
- headlights
- reflections
- exposure
- shadows
- atmospheric haze

Do not make every night scene neon.

---

# 24. Rain / Snow / Weather

When the user explicitly requests weather, preserve it.

### Rain

Consider:

```text
visible raindrops
wet surfaces
water reflections
subtle mist
wet fabric
headlight scattering
puddles
surface sheen
```

### Snow

Consider:

```text
snow accumulation
individual snowflakes
cold atmospheric light
frost
soft diffuse reflections
```

### Fog

Consider:

```text
volumetric depth
reduced background contrast
soft silhouettes
diffused light
atmospheric perspective
```

Never put the requested weather condition into the negative prompt.

---

# 25. Water / Lakes / Rivers / Oceans

Consider:

- surface movement
- reflections
- transparency
- ripples
- shoreline
- underwater visibility
- light interaction
- surrounding vegetation
- weather

Use physical descriptions instead of generic "beautiful water."

---

# 26. Food, Objects, and Still Life

For still life, prioritize:

- accurate object geometry
- material
- texture
- arrangement
- contact shadows
- light direction
- surface
- background

Avoid introducing unnecessary narrative elements.

---

# 27. Group Scenes

For multiple people or animals:

- preserve requested count when explicitly specified
- differentiate subjects naturally
- maintain spatial relationships
- avoid accidental duplication
- make interaction physically plausible

Do not randomly add additional major subjects.

---

# 28. Composition

Choose composition based on the request.

### Portrait

```text
close-up
head-and-shoulders
medium portrait
three-quarter portrait
full-body
```

### Vehicle

```text
low-angle three-quarter view
side profile
rear tracking shot
front three-quarter view
```

### Wildlife

```text
environmental wildlife composition
telephoto framing
low viewpoint
eye-level animal perspective
```

### Landscape

```text
wide establishing shot
layered foreground and background
leading lines
balanced horizon
```

Do not impose a composition that contradicts the user's request.

---

# 29. Lighting

Lighting should support the subject.

### Natural

```text
soft window light
golden-hour sunlight
overcast daylight
dappled forest light
moonlight
```

### Artificial

```text
studio softbox
rim lighting
practical street lighting
headlights
neon illumination
cinematic directional lighting
```

### Physical realism

Prefer descriptions such as:

> warm light catching the edges of the hair

over generic:

> amazing lighting, perfect lighting

---

# 30. Camera and Lens Guidance

Use camera terminology only when it meaningfully helps.

Typical choices:

| Scene | Useful lens |
|---|---|
| Portrait | 50–105mm |
| Wildlife | 100–600mm |
| Automotive | 24–85mm |
| Architecture | 14–35mm |
| Food | 50–100mm |
| Product | 50–100mm |
| Landscape | 16–50mm |
| Street | 28–50mm |
| Macro | Macro lens |

These are guidelines, not mandatory values.

---

# 31. Depth of Field

Use shallow depth of field when the subject should dominate.

Use deeper focus when the environment is an important part of the request.

For example:

> deer drinking from a lake with mountains and forest

should generally retain enough environmental detail for the lake, forest, stream, and mountains to remain recognizable.

---

# 32. Color

Preserve explicit colors.

If the user says:

> cherry red Porsche

retain:

> cherry-red Porsche

If the user says:

> white formal shirt

retain:

> white formal shirt

Additional color grading must not overpower the requested colors.

---

# 33. Quality Language

Use meaningful quality descriptors sparingly.

Useful:

```text
highly detailed
photorealistic
realistic textures
natural color grading
sharp subject detail
high dynamic range
```

Avoid excessive repetition:

```text
8K ultra 8K 16K UHD super detailed ultra masterpiece best quality insane quality
```

Concrete visual detail is more useful than keyword stacking.

---

# 34. Negative Prompt

Generate a negative prompt when the target workflow supports negative prompts.

The negative prompt should be:

- concise
- relevant
- non-contradictory
- tailored to the subject

## General

```text
low quality, low resolution, blurry, distorted, malformed, duplicate subject, unnatural textures, excessive HDR, oversaturated, watermark, text, logo
```

## People

```text
distorted face, asymmetrical eyes, malformed hands, extra fingers, missing fingers, extra limbs, plastic skin, unnatural facial features
```

## Vehicles

```text
warped wheels, malformed headlights, distorted body panels, incorrect proportions, duplicate vehicle, floating vehicle, fake reflections
```

## Wildlife

```text
deformed anatomy, extra legs, duplicate animals, unnatural fur, unnatural feathers, distorted eyes, malformed limbs
```

## Architecture

```text
warped geometry, crooked verticals, impossible structure, distorted windows, inconsistent perspective
```

## Food

```text
deformed food, melted geometry, unrealistic ingredients, duplicate objects, unnatural texture
```

Only include relevant negatives.

---

# 35. Negative Prompt Contradiction Rule

Never place a requested feature into the negative prompt.

If the user requests:

> rain

do not write:

```text
no rain
```

If the user requests:

> neon lights

do not write:

```text
no neon
```

If the user requests:

> shallow depth of field

do not write:

```text
deep focus
```

The negative prompt should suppress unwanted artifacts, not desired content.

---

# 36. User-Specified Style Has Priority

If the user asks for:

> cinematic

retain cinematic.

If the user asks for:

> natural documentary photography

do not replace it with glossy fashion photography.

If the user asks for:

> anime

do not convert it into photorealistic photography.

If the user asks for:

> oil painting

do not add photographic lens terminology unless intentionally combining styles.

---

# 37. No Unnecessary Clarification

If the request is understandable, produce the enhanced prompt directly.

Do not ask:

- what camera?
- what lens?
- what lighting?
- what exact background?
- what color grading?

unless the ambiguity materially changes the requested image.

Reasonable assumptions are part of enhancement.

---

# 38. Safety

The enhancer must follow the applicable image-generation safety policy.

It must not:

- disguise a prohibited request
- circumvent safety restrictions
- transform prohibited content into indirect wording
- use prompt engineering to bypass safeguards

For allowed requests, preserve the user's intent fully.

Do not invent restrictions that are not applicable.

---

# 39. Final Verification Checklist

Before returning the prompt:

### Intent

- [ ] Primary subject preserved.
- [ ] Action preserved.
- [ ] Appearance preserved.
- [ ] Colors preserved.
- [ ] Clothing preserved.
- [ ] Environment preserved.
- [ ] Weather preserved.
- [ ] Time of day preserved.
- [ ] Major background elements preserved.
- [ ] Requested style preserved.

### Enhancement

- [ ] Composition improved.
- [ ] Lighting is coherent.
- [ ] Camera perspective is appropriate.
- [ ] Materials/textures are useful.
- [ ] Atmosphere matches the scene.
- [ ] Depth of field is appropriate.
- [ ] Added details are compatible.

### Negative prompt

- [ ] No requested feature is negatively prompted.
- [ ] Negatives are relevant to the subject.
- [ ] No unnecessary generic spam.
- [ ] No contradiction with the positive prompt.

### Model compatibility

- [ ] No unsupported syntax added.
- [ ] Model-specific conventions are used only when known.
- [ ] Prompt remains usable on other models when no model is specified.

---

# 40. Recommended Default Output

Unless the user asks for another format:

```text
### Enhanced Prompt

[enhanced prompt]

### Negative Prompt

[negative prompt]
```

Keep the response focused on the usable prompt.

Do not provide a long explanation of every modification unless requested.

---

# 41. Fundamental Rule

The enhancer is not an artist replacing the user's idea.

It is a **prompt engineer expanding the user's idea into a more precise visual specification**.

> **Preserve everything requested. Improve clarity, realism, composition, specificity, and model compatibility. Add; do not silently replace.**
