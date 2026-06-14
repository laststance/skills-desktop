import * as React from 'react'

import { cn } from '@/renderer/src/lib/utils'

const Card = React.memo(function Card({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow',
        className,
      )}
      {...props}
    />
  )
})

const CardHeader = React.memo(function CardHeader({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-1.5 p-4', className)}
      {...props}
    />
  )
})

const CardTitle = React.memo(function CardTitle({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'h3'>) {
  return (
    // react-doctor-disable-next-line react-doctor/heading-has-content -- shadcn primitive; heading text is supplied by consumers via children/props at the call site.
    <h3
      ref={ref}
      className={cn('font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
})

const CardDescription = React.memo(function CardDescription({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'p'>) {
  return (
    <p
      ref={ref}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
})

const CardContent = React.memo(function CardContent({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'div'>) {
  return <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />
})

const CardFooter = React.memo(function CardFooter({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      ref={ref}
      className={cn('flex items-center p-4 pt-0', className)}
      {...props}
    />
  )
})

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
