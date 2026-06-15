// Vitest setup: pull in the jest-dom matchers (toBeVisible, toHaveTextContent,
// etc.) for any component tests. Pure-logic tests don't need them, but loading
// once here keeps every test file import-free.
import "@testing-library/jest-dom/vitest";
