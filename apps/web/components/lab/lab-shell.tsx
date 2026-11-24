"use client";

import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { useState } from "react";
import { CharactersTab } from "./characters-tab";
import { ChatsTab } from "./chats-tab";
import { type PaletteId, palettes, type StyleId, styles, world } from "./data";
import { TimelineTab } from "./timeline-tab";

export function LabShell() {
  const [style, setStyle] = useState<StyleId>("halo");
  const [palette, setPalette] = useState<PaletteId>("sky");
  const current = styles.find((s) => s.value === style);

  return (
    <div className="lab" data-style={style} data-palette={palette}>
      <div className="lab-switcher" role="group" aria-label="Style lab">
        <SegmentedControl
          aria-label="Style"
          className="lab-seg"
          value={style}
          onValueChange={(value) => value && setStyle(value as StyleId)}
        >
          <SegmentedControlIndicator />
          {styles.map((s) => (
            <SegmentedControlItem key={s.value} value={s.value}>
              {s.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <SegmentedControl
          aria-label="Palette"
          className="lab-seg lab-swatches"
          value={palette}
          onValueChange={(value) => value && setPalette(value as PaletteId)}
        >
          <SegmentedControlIndicator />
          {palettes.map((p) => (
            <SegmentedControlItem key={p.value} value={p.value} data-swatch={p.value}>
              <span className="lab-swatch" aria-hidden="true" />
              {p.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <p className="lab-switcher-note">{current?.blurb}</p>
      </div>

      <Tabs defaultValue="chats" className="lab-app">
        <header className="lab-bar">
          <div className="lab-brand">
            <span className="lab-wordmark">Kazusa</span>
            <span className="lab-clock">
              <span className="lab-clock-day">
                Day {world.day} · {world.weekday}
              </span>
              <time className="lab-clock-time">{world.clock}</time>
            </span>
          </div>
          <TabsList aria-label="Sections" className="lab-tabs">
            <TabsTab value="chats">Chats</TabsTab>
            <TabsTab value="people">Characters</TabsTab>
            <TabsTab value="timeline">Timeline</TabsTab>
            <TabsIndicator />
          </TabsList>
        </header>

        <main className="lab-main">
          <TabsPanel value="chats">
            <ChatsTab />
          </TabsPanel>
          <TabsPanel value="people">
            <CharactersTab />
          </TabsPanel>
          <TabsPanel value="timeline">
            <TimelineTab />
          </TabsPanel>
        </main>
      </Tabs>
    </div>
  );
}
