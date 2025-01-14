module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: `./tsconfig.eslint.json`,
    extraFileExtensions: "cjs",
  },
  plugins: [
    "@typescript-eslint",
  ],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  rules: {
    "no-empty-function": "off",
    "@typescript-eslint/member-delimiter-style": ["error", {
      "multiline": {
        "delimiter": "none",
        "requireLast": false,
      },
    }],
    "@typescript-eslint/no-empty-function": ["off"],
    "@typescript-eslint/no-explicit-any": ["off"],
    "@typescript-eslint/no-use-before-define": ["off"],
    "@typescript-eslint/semi": ["error", "never"],
    "@typescript-eslint/ban-ts-comment": 1,
    "@typescript-eslint/quotes": ["error", "double", {
      allowTemplateLiterals: true,
    }],
    // If you want to *intentionally* run a promise without awaiting, prepend it with "void " instead of "await "
    "@typescript-eslint/no-floating-promises": ["error"],
    "@typescript-eslint/no-unused-vars": [
      "warn", // or error
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
  },
}
