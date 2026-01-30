import { Search } from 'lucide-react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { setSearchQuery } from '../../redux/slices/uiSlice'
import { Input } from '../ui/input'

/**
 * Search box for filtering skills
 */
export function SearchBox(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { searchQuery } = useAppSelector((state) => state.ui)

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search skills..."
        value={searchQuery}
        onChange={(e) => dispatch(setSearchQuery(e.target.value))}
        className="pl-10 bg-background"
      />
    </div>
  )
}
