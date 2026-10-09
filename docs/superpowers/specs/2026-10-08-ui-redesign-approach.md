# UI Redesign Approach for Yomi Reader

## Explore Project Context
- Existing codebase uses TypeScript/Vite with a dark theme (midnight) based on #0f0f0f background.
- Components are built with CSS custom properties and a utility-first-ish approach.
- Layouts are responsive but currently feel narrow and sparse (as noted in user direction).
- The site already has a theme system, reader, library, novel pages, etc.

## Clarifying Questions (to be answered by user)

1. **Density and Layout**: Should we increase the maximum content width to better use desktop screen real estate (e.g., 1400px or fluid with side margins)? Should we adjust grid columns for novel cards to be more dense (e.g., 4-5 columns on large screens)?

2. **Card Design**: Should we adopt a card-based design with elevated surfaces, subtle borders, and hover effects for all interactive elements (novel cards, volume lists, chapter list items, etc.)?

3. **Navigation**: Should we redesign the navbar to be more compact yet informative, perhaps with a logo/brand on left, navigation links center, and theme/user actions on right? Should we make it sticky or hide on scroll?

4. **Reader**: Should the reader toolbar be less prominent (maybe hide on scroll) and the chapter indicator more subtle? Should we adjust the reader content max-width to be larger for immersive reading?

5. **Accent Color**: The current accent is a soft blue (#7c9cbf). Should we keep a similar restrained accent, or allow the user to choose from a set of muted accent colors (e.g., soft purple, teal, rose)?

6. **Animation and Interaction**: Should we keep animations subtle (hover, focus, page transitions) or add more micro-interactions (e.g., card tilt on hover, subtle lift)?

7. **Accessibility**: Ensure all changes maintain or improve accessibility (contrast, focus outlines, ARIA labels).

## Proposed Approaches

### Approach 1: Incremental Refinement
- Keep existing structure, adjust CSS variables for darker surfaces, increase max-width, tweak card padding and borders, update hover effects.
- Pros: Minimal risk, quick to implement, preserves existing functionality.
- Cons: May not achieve the desired density and premium feel fully.

### Approach 2: Design System Overhaul
- Introduce a new set of design tokens (background, surface, surface-hover, border, text-primary, text-secondary, accent, radius, shadow, spacing scale).
- Refactor all components to use these tokens consistently.
- Redesign layouts to use a 12-column grid or similar for better alignment.
- Increase card density and use elevated surfaces with shadows.
- Pros: Systematic, reusable, easier to theme and maintain.
- Cons: More work upfront, risk of introducing bugs.

### Approach 3: Hybrid with Visual Focus
- Focus on image-heavy areas: novel cards, novel header, reader background, chapter blocks.
- Use larger cover images, subtle overlays, and typography that complements artwork.
- Adjust spacing to let images breathe while keeping UI dense.
- Pros: Highlights the core content (covers and text), visually engaging.
- Cons: May require adjusting image assets and could affect performance if not optimized.

## Recommendation
**Approach 2 (Design System Overhaul)** is recommended because it provides a solid foundation for a polished, premium feel and ensures consistency across the platform. It will make future theming and adjustments easier.

## Design Sections for Approval

We will present the design in the following sections for user approval:
1. Design Tokens and Color Palette
2. Layout and Spacing (max-width, grid, padding)
3. Component Styles (cards, buttons, inputs, navbars)
4. Reader UI Adjustments
5. Dark Theme Refinements
6. Responsive Breakpoints and Mobile Adjustments

After each section, we will seek user approval before proceeding.