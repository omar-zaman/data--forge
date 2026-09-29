"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetPortal = SheetPrimitive.Portal
const SheetClose = SheetPrimitive.Close

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/60", className)}
    {...props}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

type SheetSide = "right" | "left"

const SIDE_CLASS: Record<SheetSide, string> = {
  right:
    "inset-y-0 right-0 border-l data-[state=open]:animate-[sheet-in-right_200ms_ease-out] data-[state=closed]:animate-[sheet-out-right_150ms_ease-in]",
  left:
    "inset-y-0 left-0 border-r data-[state=open]:animate-[sheet-in-left_200ms_ease-out] data-[state=closed]:animate-[sheet-out-left_150ms_ease-in]",
}

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> {
  side?: SheetSide
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    {/* Radix renders the overlay only for modal sheets */}
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex h-full w-full flex-col gap-4 border-[var(--color-border)] bg-[var(--color-background)] p-6 text-[var(--color-foreground)] shadow-lg motion-reduce:animate-none sm:max-w-md",
        SIDE_CLASS[side],
        className
      )}
      {...props}
    >
      {children}
      <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none">
        <X className="size-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 pr-8", className)} {...props} />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-auto flex flex-col gap-2", className)} {...props} />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-[var(--color-muted-foreground)]", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
