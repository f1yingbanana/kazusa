"use client";

import {
  FileInput,
  FileInputDropzone,
  FileInputTrigger,
} from "@ui-sdk/react/file-input";
import type { ReactNode } from "react";

export { FileInputTrigger as FileDropTrigger };

/**
 * Takes one file, chosen, dropped or pasted, and hands it on, holding nothing
 * itself. Children get whether a file is being dragged over; put a
 * `FileDropTrigger` among them for the keyboard and the file picker.
 */
export function FileDrop({
  accept,
  maxSize,
  disabled,
  onFile,
  onReject,
  children,
}: {
  accept: readonly string[];
  maxSize?: number;
  disabled?: boolean;
  onFile: (file: File) => void;
  onReject?: () => void;
  children: (state: { dragging: boolean }) => ReactNode;
}) {
  return (
    <FileInput
      accept={accept}
      maxSize={maxSize}
      disabled={disabled}
      value={[]}
      onValueChange={(files) => {
        const [file] = files;
        if (file) onFile(file);
      }}
      onReject={onReject}
    >
      <FileInputDropzone className="contents">
        {(state: { dragging: boolean }) =>
          children({ dragging: state.dragging })
        }
      </FileInputDropzone>
    </FileInput>
  );
}
