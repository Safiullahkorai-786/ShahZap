import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-vitals";
import nextTs from "eslint-config-next/typescript";
import react from "eslint-plugin-react";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"],
    plugins: { react },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "react/display-name": "off",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "out/**"]),
]);
