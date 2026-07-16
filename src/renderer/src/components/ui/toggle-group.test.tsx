import * as React from 'react'
import { describe, expect, it } from 'vitest'

import { injectToggleGroupDefaults, ToggleGroupItem } from './toggle-group'

type ToggleGroupItemProps = React.ComponentProps<typeof ToggleGroupItem>

describe('injectToggleGroupDefaults', () => {
  it('applies group defaults to direct items while preserving item overrides', () => {
    // Arrange
    const children = [
      <ToggleGroupItem key="defaulted" value="defaulted">
        Defaulted
      </ToggleGroupItem>,
      <ToggleGroupItem
        key="overridden"
        value="overridden"
        variant="default"
        size="lg"
      >
        Overridden
      </ToggleGroupItem>,
    ]

    // Act
    const result = React.Children.toArray(
      injectToggleGroupDefaults(children, 'outline', 'sm'),
    )

    // Assert
    expect(result).toHaveLength(2)
    expect(React.isValidElement<ToggleGroupItemProps>(result[0])).toBe(true)
    expect(React.isValidElement<ToggleGroupItemProps>(result[1])).toBe(true)

    if (
      !React.isValidElement<ToggleGroupItemProps>(result[0]) ||
      !React.isValidElement<ToggleGroupItemProps>(result[1])
    ) {
      throw new Error('Expected direct ToggleGroupItem children')
    }

    expect(result[0].props.variant).toBe('outline')
    expect(result[0].props.size).toBe('sm')
    expect(result[1].props.variant).toBe('default')
    expect(result[1].props.size).toBe('lg')
  })

  it('leaves text, fragments, wrappers, and nested items unchanged', () => {
    // Arrange
    const fragment = (
      <React.Fragment key="fragment">
        <ToggleGroupItem value="fragment-item">Fragment item</ToggleGroupItem>
      </React.Fragment>
    )
    const wrapper = (
      <span key="wrapper">
        <ToggleGroupItem value="nested-item">Nested item</ToggleGroupItem>
      </span>
    )

    // Act
    const result = React.Children.toArray(
      injectToggleGroupDefaults(['Label', fragment, wrapper], 'outline', 'sm'),
    )

    // Assert
    expect(result[0]).toBe('Label')
    expect(React.isValidElement(result[1]) && result[1].type).toBe(
      React.Fragment,
    )
    expect(
      React.isValidElement<{ children: React.ReactNode }>(result[2]) &&
        result[2].type,
    ).toBe('span')

    if (!React.isValidElement<{ children: React.ReactNode }>(result[2])) {
      throw new Error('Expected wrapper element')
    }

    const nestedItem = React.Children.only(result[2].props.children)
    expect(React.isValidElement<ToggleGroupItemProps>(nestedItem)).toBe(true)

    if (!React.isValidElement<ToggleGroupItemProps>(nestedItem)) {
      throw new Error('Expected nested ToggleGroupItem child')
    }

    expect(nestedItem.props.variant).toBeUndefined()
    expect(nestedItem.props.size).toBeUndefined()
  })
})
