"use client";

import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue } from "@ui-sdk/react/meter";
import { useState } from "react";
import { characterById, characters } from "./data";
import { Portrait } from "./portrait";

export function CharactersTab() {
  const [selectedId, setSelectedId] = useState(characters[0].id);
  const person = characterById[selectedId];

  return (
    <div className="lab-people">
      <Listbox
        aria-label="Residents"
        className="lab-roster"
        value={selectedId}
        onValueChange={(value) => typeof value === "string" && setSelectedId(value)}
      >
        {characters.map((c) => (
          <ListboxItem key={c.id} value={c.id} label={c.name}>
            <Portrait character={c} size="sm" decorative />
            <span className="lab-roster-body">
              <span className="lab-roster-name">{c.name}</span>
              <span className="lab-roster-place">{c.awake ? c.place : "Resting"}</span>
            </span>
          </ListboxItem>
        ))}
      </Listbox>

      <article className="lab-profile" aria-labelledby="lab-profile-name" key={person.id}>
        <figure className="lab-profile-art">
          <img src={person.image} alt={`Portrait of ${person.name}`} />
        </figure>

        <div className="lab-profile-body">
          <header className="lab-profile-head">
            <p className="lab-profile-reading" lang="ja">
              {person.reading}
            </p>
            <h2 id="lab-profile-name" className="lab-profile-name">
              {person.name}
            </h2>
            <p className="lab-profile-role">{person.role}</p>
          </header>

          <div className="lab-now">
            <p className="lab-now-doing">{person.doing}</p>
            <p className="lab-now-where">
              {person.place} · feeling {person.mood.toLowerCase()}
            </p>
          </div>

          <div className="lab-needs">
            {person.needs.map((need) => (
              <Meter key={need.id} value={need.value} data-need={need.id} data-low={need.value < 30 || undefined}>
                <MeterLabel>{need.label}</MeterLabel>
                <MeterValue />
                <MeterTrack>
                  <MeterIndicator />
                </MeterTrack>
              </Meter>
            ))}
          </div>

          <section className="lab-wants" aria-labelledby="lab-wants-title">
            <h3 id="lab-wants-title">Wants right now</h3>
            <p>{person.wants}</p>
          </section>

          <section className="lab-memories" aria-labelledby="lab-memories-title">
            <h3 id="lab-memories-title">Remembers</h3>
            <ul>
              {person.memories.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </section>
        </div>
      </article>
    </div>
  );
}
