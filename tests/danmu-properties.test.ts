import test from "node:test";
import assert from "node:assert/strict";
import {
  ANIMATABLE_KEYS,
  ANIMATABLE_KEYS_BY_TYPE,
  COLOR_PROPERTY_KEYS,
  DANMU_PROPERTY_BY_KEY,
  DANMU_PROPERTY_LIST,
  DEFINITION_FIELDS_BY_TYPE,
  IDENTITY_FIELD_BY_TYPE,
  IMPORTABLE_FIELDS_BY_TYPE,
  INSTANT_PROPERTY_KEYS,
  NUMERIC_INTERPOLATION_KEYS,
  PERCENTAGE_PROPERTY_KEYS,
  toBasPropertyKey,
  toEditorPropertyKey
} from "../src/core/danmuProperties";

test("danmu property registry has unique keys and reversible BAS aliases", () => {
  assert.equal(DANMU_PROPERTY_BY_KEY.size, DANMU_PROPERTY_LIST.length);

  for (const spec of DANMU_PROPERTY_LIST) {
    const basKey = toBasPropertyKey(spec.key);
    assert.equal(toEditorPropertyKey(basKey), spec.key);
  }

  assert.equal(toBasPropertyKey("opacity"), "alpha");
  assert.equal(toEditorPropertyKey("alpha"), "opacity");
  assert.equal(toBasPropertyKey("parentId"), "parent");
  assert.equal(toEditorPropertyKey("parent"), "parentId");
  assert.equal(toBasPropertyKey("durationMs"), "duration");
  assert.equal(toEditorPropertyKey("duration"), "durationMs");
});

test("all per-type definition, importable, and animatable fields are registered", () => {
  for (const type of ["text", "button", "path"] as const) {
    assert.ok(DANMU_PROPERTY_BY_KEY.has(IDENTITY_FIELD_BY_TYPE[type]));

    for (const key of DEFINITION_FIELDS_BY_TYPE[type]) {
      assert.ok(DANMU_PROPERTY_BY_KEY.has(key), `Unregistered definition field ${type}.${key}`);
    }

    for (const key of IMPORTABLE_FIELDS_BY_TYPE[type]) {
      assert.ok(DANMU_PROPERTY_BY_KEY.has(key), `Unregistered importable field ${type}.${key}`);
      assert.notEqual(key, "parentId");
    }

    for (const key of ANIMATABLE_KEYS_BY_TYPE[type]) {
      assert.ok(ANIMATABLE_KEYS.includes(key));
      assert.ok(
        IMPORTABLE_FIELDS_BY_TYPE[type].includes(key),
        `Animatable key ${type}.${key} should be importable on ${type}`
      );
    }
  }
});

test("derived property sets match expected BAS semantics", () => {
  const expectedAnimatable = DANMU_PROPERTY_LIST.filter(
    (spec) => "animatableOn" in spec && spec.animatableOn.length > 0
  ).map((spec) => spec.key);
  assert.deepEqual(ANIMATABLE_KEYS, expectedAnimatable);
  assert.deepEqual([...PERCENTAGE_PROPERTY_KEYS], ["x", "y", "fontSize", "width", "height"]);
  assert.deepEqual([...COLOR_PROPERTY_KEYS], ["color", "strokeColor", "textColor", "fillColor", "borderColor"]);
  assert.deepEqual([...INSTANT_PROPERTY_KEYS], ["content", "text", "fontSize"]);
  assert.deepEqual([...NUMERIC_INTERPOLATION_KEYS], ["x", "y", "scale", "rotateX", "rotateY", "rotateZ", "opacity"]);
});
