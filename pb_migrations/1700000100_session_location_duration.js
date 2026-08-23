/// <reference path="../pb_data/types.d.ts" />

// Adds location + duration to both session collections, for the Start/End
// Session flow: location is entered when a session starts, duration is
// measured from start to end.
migrate((app) => {
  for (const name of ["mechanics_sessions", "pitch_sessions"]) {
    const collection = app.findCollectionByNameOrId(name);
    collection.fields.add(new Field({ type: "text", name: "location", max: 200 }));
    collection.fields.add(new Field({ type: "number", name: "duration_seconds" }));
    app.save(collection);
  }
}, (app) => {
  for (const name of ["mechanics_sessions", "pitch_sessions"]) {
    const collection = app.findCollectionByNameOrId(name);
    collection.fields.removeByName("location");
    collection.fields.removeByName("duration_seconds");
    app.save(collection);
  }
});
