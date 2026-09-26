"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { IMAGE_ACCEPT } from "@/lib/media";
import { Button } from "@/components/ui";
import { Paperclip } from "@/components/Icons";

/** "Attach images" for a composer that uploads through useImageUploads. */
export function AttachImagesButton({
  onFiles,
  disabled,
  label,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const t = useTranslations("media");
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => input.current?.click()}>
        <Paperclip size={15} />
        {label ?? t("add")}
      </Button>
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          onFiles(files);
        }}
      />
    </>
  );
}
