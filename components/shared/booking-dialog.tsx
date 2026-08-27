"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNpr } from "@/lib/utils";

/**
 * Demonstrates the modal against a real flow rather than placeholder text.
 * The actual booking flow is Phase 6 — this exists so the dialog primitive
 * gets exercised with content of the right shape and length.
 */
export function BookingDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="sindoor">Book now</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Book Ramesh Tamang</DialogTitle>
          <DialogDescription>
            Plumbing · Lalitpur, Ward 4 · usually on site within the hour.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="booking-landmark">Nearest landmark</Label>
            <Input
              id="booking-landmark"
              placeholder="e.g. Patan Durbar Square"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="booking-note">What needs fixing?</Label>
            <Input
              id="booking-note"
              placeholder="Kitchen tap leaking since morning"
            />
          </div>
          <p className="text-caption text-muted-foreground">
            Estimated {formatNpr(1200)}–{formatNpr(1800)}. You pay after the job
            is done — cash, eSewa or Khalti.
          </p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Not now</Button>
          </DialogClose>
          <Button variant="sindoor">Confirm booking</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
