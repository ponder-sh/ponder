import type { GraphQLResolveInfo } from "graphql";
import { Kind } from "graphql";
import { expect, test } from "vitest";
import { hasSubfield } from "./hasSubfield.js";

const resolveInfo: any = {
  fieldName: "pageInfo",
  fieldNodes: [
    {
      kind: Kind.FIELD,
      name: {
        kind: Kind.NAME,
        value: "table",
      },
      selectionSet: {
        kind: Kind.SELECTION_SET,
        selections: [
          {
            kind: Kind.FIELD,
            name: {
              kind: Kind.NAME,
              value: "pageInfo",
            },
            selectionSet: {
              kind: Kind.SELECTION_SET,
              selections: [
                {
                  kind: Kind.FIELD,
                  name: {
                    kind: Kind.NAME,
                    value: "totalCount",
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
};

test("hasSubfield detects presence of subfield in info", () => {
  expect(
    hasSubfield(resolveInfo as GraphQLResolveInfo, ["pageInfo", "totalCount"]),
  ).toEqual(true);
});

test("hasSubfield detects absence of subfield in info", () => {
  expect(
    hasSubfield(resolveInfo as GraphQLResolveInfo, ["pageInfo", "startCursor"]),
  ).toEqual(false);
});
