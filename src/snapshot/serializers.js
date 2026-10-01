// pretty-format plugins added with expect.addSnapshotSerializer(), the last added first.
const serializers = [];

function addSnapshotSerializer(serializer) {
  serializers.unshift(serializer);
}

module.exports = { serializers, addSnapshotSerializer };
