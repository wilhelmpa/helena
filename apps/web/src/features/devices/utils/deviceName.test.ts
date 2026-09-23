import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deviceName } from './deviceName';

const ID = 'IPHONEA-AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG';

describe('device name', () => {
  test('uses the name the device gave itself', () => {
    assert.equal(deviceName({ name: 'iPhone', deviceId: ID }), 'iPhone');
  });

  test('falls back to the first group of the ID', () => {
    assert.equal(deviceName({ name: '  ', deviceId: ID }), 'IPHONEA');
  });
});
