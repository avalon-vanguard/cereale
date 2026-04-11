# Contributing to Optimus

Thank you for your interest in contributing to Optimus! We welcome all contributions, from bug reports to new features and documentation improvements.

## Development Setup

To get started with development, follow these steps:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Avalon-Vanguard/optimus.git
    cd optimus
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the demo:**
    You can run the example script to see the library in action:
    ```bash
    npm run demo
    ```

## Project Structure

- `src/`: Contains the source code.
    - `decorators.ts`: Custom decorators (@JsonSerialize, @JsonDeserialize, etc.).
    - `interfaces.ts`: Core interfaces for serializers and deserializers.
    - `utils.ts`: `JsonMapper` utility for serialization and validation.
    - `index.ts`: Public API entry point.
- `src/example.ts`: Demonstrates the usage of the library.

## Coding Guidelines

- **TypeScript:** This project is written in TypeScript. Ensure all new code is properly typed.
- **Documentation:** Use JSDoc for all public functions, classes, and interfaces.
- **Style:** Follow the existing coding style and formatting.
- **Internal Mapping Engine:** The project uses a custom, dependency-free engine for mapping and validation. Do not add external dependencies without project-wide discussion.
- **Validation:** Use internal validation decorators.
- **Transformation:** Leverage the internal `JsonMapper` utility.

## Pull Request Process

1.  Create a new branch for your feature or bug fix: `git checkout -b feat/your-feature-name` or `fix/your-bug-fix`.
2.  Make your changes and ensure the code compiles.
3.  Add or update documentation as needed.
4.  Run the tests to verify your changes: `npm test`.
5.  Commit your changes with a descriptive message.
6.  Push your branch to GitHub and open a Pull Request.

## Bug Reports and Feature Requests

Please use GitHub Issues to report bugs or suggest new features. Provide as much detail as possible, including steps to reproduce bugs and clear descriptions of feature requests.

---

By contributing to this project, you agree to abide by the terms of the ISC License.
