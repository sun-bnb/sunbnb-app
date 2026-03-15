# UI Package (packages/ui)

`@repo/ui` — shared React component library.

## Components

Button, TextField, Card, Code — basic building blocks shared across apps.

## Styling

Tailwind CSS 3. Note: the same Button and TextField components are also duplicated in `@repo/data` (historical quirk). MUI 5 is also used in the partner app — progressive migration toward pure Tailwind is ongoing.

## Usage

Import as `@repo/ui` in app code. Components are simple, presentational, no business logic.
