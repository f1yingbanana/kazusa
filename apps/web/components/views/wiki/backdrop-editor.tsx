"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useWikiBackdrops } from "@/hooks/use-wiki-editor";
import { removePicture, uploadPicture } from "@/lib/source/wiki/editor";
import { AddTile, PictureTile, failureText, usePicturePicker } from "./parts";

/** An empty slot: choosing a picture puts it in under the slot's name. */
function EmptySlot({
  label,
  onFile,
}: {
  label: string;
  onFile: (file: File) => Promise<void>;
}) {
  const { pick, input } = usePicturePicker(([file]) => {
    if (file)
      void onFile(file).catch((failure: unknown) =>
        toast.error(failureText(failure)),
      );
  });
  return (
    <div className="flex flex-col gap-1.5">
      <AddTile label={label} aspect="aspect-video" onClick={pick} />
      {input}
    </div>
  );
}

/**
 * One backdrop set: a picture for each time of day, and for each state the set
 * declares (rain, a festival), the places that stand in front of it.
 */
export function BackdropEditor({ name }: { name: string }) {
  const { data, error, isLoading, mutate } = useWikiBackdrops();
  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (error || !data)
    return (
      <p className="p-6 text-sm text-destructive">
        {error ? failureText(error) : "Couldn't read the backdrops."}
      </p>
    );
  const set = data.sets.find((one) => one.name === name);
  const states = [undefined, ...Object.keys(set?.states ?? {})];
  const fileOf = (state: string | undefined, time: string) =>
    set?.files.find((file) => file.state === state && file.time === time);
  const others =
    set?.files.filter((file) => !data.times.includes(file.time)) ?? [];
  const put = async (pictureName: string, file: File) => {
    await uploadPicture(
      { kind: "backdrop", set: name, name: pictureName },
      file,
    );
    await mutate();
  };
  const remove = async (pictureName: string) => {
    await removePicture({ kind: "backdrop", set: name, name: pictureName });
    await mutate();
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 lg:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-xl font-semibold tracking-tight">
          {name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {set?.places.length ? (
            <>
              Shown at{" "}
              {set.places.map((place, index) => (
                <span key={place.id}>
                  {index > 0 ? ", " : null}
                  <Link
                    href={`?view=wiki&wiki.page=${encodeURIComponent(place.id)}`}
                    className="text-foreground underline-offset-4 hover:underline"
                  >
                    {place.name}
                  </Link>
                </span>
              ))}
              .
            </>
          ) : (
            "No place shows it yet: a place shows it once its wiki page names it as its backdrop."
          )}
        </p>
      </header>
      {states.map((state) => (
        <section key={state ?? ""} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">
              {state ? <span className="font-mono">{state}</span> : "Usual"}
            </h2>
            {state ? (
              <p className="text-sm text-muted-foreground">
                {set?.states[state]}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
            {data.times.map((time) => {
              const pictureName = state ? `${state}-${time}` : time;
              const file = fileOf(state, time);
              return file ? (
                <PictureTile
                  key={time}
                  url={file.url}
                  name={time}
                  aspect="aspect-video"
                  what={`the ${pictureName} backdrop`}
                  onReplace={(next) => put(pictureName, next)}
                  onRemove={() => remove(pictureName)}
                />
              ) : (
                <EmptySlot
                  key={time}
                  label={`Add ${time}`}
                  onFile={(next) => put(pictureName, next)}
                />
              );
            })}
          </div>
        </section>
      ))}
      {others.length ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Other pictures</h2>
            <p className="text-sm text-muted-foreground">
              Named for no time of day this world has, so no scene shows them.
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
            {others.map((file) => (
              <PictureTile
                key={file.name}
                url={file.url}
                name={file.name}
                aspect="aspect-video"
                what={`the ${file.name} backdrop`}
                onReplace={(next) => put(file.name, next)}
                onRemove={() => remove(file.name)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
