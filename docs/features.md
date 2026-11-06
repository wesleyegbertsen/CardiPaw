# Features

What each part of CardiPaw does. For a quick overview see the [README](../README.md#features).

## Multiple pets

Add as many pets as you need, each with a name, species, photo, and date of birth. All data is stored locally on your device, and your pet data is never sent to any server.

## Guided tracking

The built-in tracker walks you through a 15-, 30- or 60-second measurement (30 by default, remembered per pet). Tap the button each time your pet takes a breath, and CardiPaw calculates the rate automatically. The screen stays on while you count, where your browser or phone allows it.

## Camera counting (experimental)

Turn on **Camera breath counting** in **Settings → Experimental** and the tracker gets a third mode, **Camera**. Prop the phone up so the camera sees your pet's chest or belly, frame it in the box, and CardiPaw watches the rise and fall for 30 seconds (60 when the reading sits close to a status threshold, or when 30 seconds weren't enough) and suggests a count. The count is a suggestion for you to check against your pet: nothing is saved until you confirm it, and you can measure again or discard it. If you tap along while it watches, you can save your own count instead, as an ordinary guided reading. When the camera can't give a count (the phone moved, too little light or detail, no steady breathing movement) it says why and offers counting by tapping.

Camera readings carry a camera tag in the readings list, the reading view, share links and PDF reports, and they are left out of [trend alerts](#trend-alerts) while the feature is experimental.

Limits: it is tuned for cats and small dogs at rest, counting 9 to 90 breaths per minute (large dogs often breathe more slowly than that); the phone must be propped up, not held; the room should be lit; and a fan, a TV or a stroking hand in the picture confuses it. It has been validated on synthetic scenes so far, which is why it is off by default and labelled experimental.

Privacy: the video is analysed on your device, frame by frame, and never recorded, stored or sent anywhere. The camera is released as soon as the count ends, is interrupted or you leave the screen. For the Android app's camera permission, see [Camera](android.md#camera).

## Readings

Every measurement is saved with a timestamp and labelled **Normal**, **Elevated** or **High** against the [status thresholds](../README.md#status-thresholds): the defaults, or the pet's own ceilings when you set them in its profile. The readings list loads incrementally so it stays fast even with hundreds of entries.

When saving a reading you can optionally record your pet's **rest state** (resting or sleeping) and add a free-text **note** (for example, whether they had just eaten, were in an unusual position, or anything else worth remembering). The rest state always appears alongside the reading in the list and in the exported PDF report. A reading with a note is marked in the list, and the note itself is in the PDF only when you turn on **Include reading notes** before exporting.

## Charts

Visualise trends over time with a line chart that supports three time ranges:

- **Week** — individual readings over the past 7 days
- **Month** — daily averages for the selected month
- **Year** — monthly averages for the selected year

Navigate backwards and forwards through history with previous/next controls, or jump straight back to the current period. The chart automatically disables navigation when there is no data further back.

## Home screen sparkline

Each pet on the home screen shows a compact 7-day sparkline so you can see at a glance whether the trend is stable, rising, or falling, without opening the detail view.

## Trend alerts

CardiPaw keeps an eye on the trend for you. When a pet's resting breathing rate has crept up, the pet's card on the home screen and the header of its detail view show a **Trending up** badge (**Above normal** for the second rule below). Tap the badge in the detail view to see the numbers behind it and what to do next. An alert shows when either of these is true:

- on **at least 2 of the last 3 days**, the rate was **20% and 4 breaths/min or more** above the pet's usual rate, or
- on **at least 2 of the last 3 days**, the rate was above the pet's Normal ceiling (see [Status Thresholds](../README.md#status-thresholds), or the pet's own ceiling when one is set).

Each day counts once, using the median (middle value) of that day's readings, so measuring again on the same day doesn't count twice. The usual rate is the median of the day values over the 28 days before the last 3, and it needs readings on at least 7 of those 28 days; the Normal-ceiling rule works without it. Readings counted with the camera (experimental, see [Camera counting](#camera-counting-experimental)) are left out of both windows.

The alert goes away on its own once readings settle. With too few readings nothing is shown, so no alert doesn't always mean all is well. Mixing sleeping and resting readings can also make the rate look higher, because the rate is usually lower during sleep. The badge's details in the app explain all of this too.

A trend alert is not a diagnosis. If you're worried, contact your vet, and if your pet is struggling to breathe, contact them straight away.

## PDF report

Generate a PDF report for any pet directly from the detail view. Select one or more months from the full history, choose whether to order them newest or oldest first, and CardiPaw produces a report where each month gets its own chart and a complete reading list with timestamps and status labels. This makes it easy to hand your vet a clear, structured overview of your pet's RRR measurements.

## Share

Create a shareable link for any pet directly from the detail view — for example to give your vet a quick overview. Select which months to include and CardiPaw packs the pet's name, species and date of birth (and its own Normal and Elevated ceilings, if you set them), along with the readings from those months, into the link itself — compressed and encoded in the URL fragment, which browsers never send to any server. Opening the link shows a standalone read-only report with summary statistics, a chart and a reading list per month, without exposing the rest of the app. Nothing is uploaded or stored: the link *is* the data, so anyone you send it to can see it.

## Pet notes

Each pet has a general-purpose **Notes** tab where you can write anything that does not fit neatly into a reading: medication changes, vet visit summaries, behavioural observations, or anything else you want to keep alongside the RRR data. Notes are stored locally with the rest of your pet's data and are included in the data export.

## Reminders

Reminders to measure a pet, at a time and on the weekdays you choose, are part of the [Android app](android.md). How they work: [Reminders](android.md#reminders).

## Data export & import

Export all pets, readings and notes as a JSON file for backup or transfer. Import a previously exported file to restore your data. In the Android app, [automatic backups](android.md#automatic-backups) can save the same file to a folder you pick.

## Languages

CardiPaw is available in **English**, **Dutch**, **German**, **French**, and **Japanese**. On first launch the app picks a language from your browser settings (falling back to English), and you can switch it at any time using the flag picker in the home screen header — your choice is remembered locally. Dates and numbers are formatted according to the selected language.
