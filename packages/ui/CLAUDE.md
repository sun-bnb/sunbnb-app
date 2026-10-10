# UI Package (packages/ui)

`@repo/ui` — shared React component library.

## Components

Button, TextField, Card, Code — basic building blocks shared across apps.

## Styling

Tailwind CSS 4, compiled by the consuming app (each app lists `packages/ui/src` as an `@source`; this package ships no CSS of its own). Note: the same Button and TextField components are also duplicated in `@repo/data` (historical quirk). MUI 5 is also used in the partner app — progressive migration toward pure Tailwind is ongoing.

## Usage

Import as `@repo/ui` in app code. Components are simple, presentational, no business logic.
