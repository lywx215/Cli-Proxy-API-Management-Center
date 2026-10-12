import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconChevronDown, IconChevronUp } from '@/components/ui/icons';
import type { ProviderRecentUsageMap } from '@/components/providers/utils';
import type { ProviderResource } from '../types';
import { getGeminiTarget, geminiTargetId, paginateGeminiResources } from '../geminiManagement';
import { getGeminiGroupKeys, getGeminiOverrideFields } from '../geminiGroups';
import { ProviderResourceTable } from './ProviderResourceTable';
import styles from './GeminiGroupedResources.module.scss';

interface GeminiGroupedResourcesProps {
  groups: Record<string, unknown>[];
  resources: ProviderResource[];
  filteredResources: ProviderResource[];
  includeEmpty: boolean;
  groupFilter: string;
  nameFilter: string;
  pageSize: number;
  compact: boolean;
  aliasCount: number;
  selected: ReadonlySet<string>;
  disabled: boolean;
  selectedId: string | null;
  focusGroup?: number;
  usageByProvider?: ProviderRecentUsageMap;
  onSelect: (resources: ProviderResource[], checked: boolean) => void;
  onAdd: (groupIndex: number) => void;
  onEditGroup: (groupIndex: number) => void;
  onView: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onToggle: (resource: ProviderResource, disabled: boolean) => void;
}

const endpointLabel = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return null;
  }
};

export function GeminiGroupedResources(props: GeminiGroupedResourcesProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(props.focusGroup === undefined ? [] : [props.focusGroup])
  );
  const [keyPages, setKeyPages] = useState<Record<number, number>>({});
  const byGroup = useMemo(() => {
    const filtered = new Map<number, ProviderResource[]>();
    const all = new Map<number, ProviderResource[]>();
    for (const [entries, target] of [
      [props.filteredResources, filtered],
      [props.resources, all],
    ] as const) {
      entries.forEach((resource) => {
        const index = getGeminiTarget(resource)?.groupIndex;
        if (index !== undefined) {
          const rows = target.get(index) ?? [];
          rows.push(resource);
          target.set(index, rows);
        }
      });
    }
    return { filtered, all };
  }, [props.filteredResources, props.resources]);
  const eligible = props.groups.flatMap((group, index) => {
    if (props.groupFilter && props.groupFilter !== String(index)) return [];
    const rows = byGroup.filtered.get(index) ?? [];
    const empty = getGeminiGroupKeys(group).length === 0;
    if (
      rows.length === 0 &&
      !(
        props.includeEmpty &&
        empty &&
        String(group.name ?? '')
          .toLowerCase()
          .includes(props.nameFilter)
      )
    )
      return [];
    return [{ group, index, rows }];
  });
  const [groupPage, setGroupPage] = useState(() => {
    const index = eligible.findIndex((entry) => entry.index === props.focusGroup);
    return index < 0 ? 1 : Math.floor(index / props.pageSize) + 1;
  });
  const { currentPage, totalPages, pageItems } = paginateGeminiResources(
    eligible,
    groupPage,
    props.pageSize
  );

  return (
    <div className={styles.groups}>
      {pageItems.length === 0 && <p className={styles.empty}>{t('providersPage.table.empty')}</p>}
      {pageItems.map(({ group, index, rows }) => {
        const keys = getGeminiGroupKeys(group);
        const allResources = byGroup.all.get(index) ?? [];
        const independent = keys.filter((key) => getGeminiOverrideFields(key).length > 0).length;
        const allSelected =
          allResources.length > 0 &&
          allResources.every((resource) => {
            const target = getGeminiTarget(resource);
            return target && props.selected.has(geminiTargetId(target));
          });
        const keyPage = paginateGeminiResources(rows, keyPages[index] ?? 1, props.pageSize);
        const models = Array.isArray(group.models) ? group.models : [];
        return (
          <section className={styles.group} key={index}>
            <div className={styles.groupHeader}>
              <div className={styles.title}>
                <SelectionCheckbox
                  checked={allSelected}
                  disabled={props.disabled || allResources.length === 0}
                  ariaLabel={t('gemini_groups.selectWholeGroup', {
                    name: String(group.name ?? `#${index + 1}`),
                    count: keys.length,
                  })}
                  title={t('gemini_groups.selectWholeGroup', {
                    name: String(group.name ?? `#${index + 1}`),
                    count: keys.length,
                  })}
                  onChange={(checked) => props.onSelect(allResources, checked)}
                />
                <div>
                  <h3>{String(group.name ?? `#${index + 1}`)}</h3>
                  <span className={styles.summary}>
                    {t('gemini_groups.keyCount', { count: keys.length })}
                    {' · '}
                    {t('gemini_groups.enabledCount', {
                      count: allResources.filter((resource) => !resource.disabled).length,
                    })}
                    {' · '}
                    {t('gemini_groups.overrides', { count: independent })}
                  </span>
                </div>
              </div>
              <div className={styles.buttons}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={props.disabled}
                  onClick={() => props.onEditGroup(index)}
                >
                  {t('gemini_groups.editGroup')}
                </Button>
                <Button size="sm" disabled={props.disabled} onClick={() => props.onAdd(index)}>
                  {t('gemini_groups.addKeys')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={expanded.has(index)}
                  onClick={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    })
                  }
                >
                  {expanded.has(index) ? (
                    <IconChevronUp size={16} />
                  ) : (
                    <IconChevronDown size={16} />
                  )}
                  {t(
                    expanded.has(index) ? 'gemini_groups.collapseKeys' : 'gemini_groups.expandKeys'
                  )}
                </Button>
              </div>
            </div>
            <div className={styles.facts}>
              <div>
                <span>{t('gemini_groups.field.base-url')}</span>
                <div>{endpointLabel(group['base-url']) ?? t('gemini_groups.defaultEndpoint')}</div>
              </div>
              <div>
                <span>{t('gemini_groups.field.proxy-url')}</span>
                <div>
                  {typeof group['proxy-url'] !== 'string' || !group['proxy-url'].trim()
                    ? t('gemini_groups.inheritGlobalProxy')
                    : /^(direct|direct:\/\/)$/i.test(group['proxy-url'].trim())
                      ? t('gemini_groups.directProxy')
                      : (endpointLabel(group['proxy-url']) ?? t('gemini_groups.invalidProxy'))}
                </div>
              </div>
              <div>
                <span>{t('gemini_groups.field.models')}</span>
                <div>
                  {models.length
                    ? t('gemini_groups.groupModels', { count: models.length })
                    : t('gemini_groups.catalog')}
                </div>
              </div>
            </div>
            {expanded.has(index) && (
              <div className={styles.keys}>
                <ProviderResourceTable
                  resources={keyPage.pageItems}
                  selectedId={props.selectedId}
                  compact={props.compact}
                  aliasCount={props.aliasCount}
                  disableMutations={props.disabled}
                  usageByProvider={props.usageByProvider}
                  onView={props.onView}
                  onEdit={props.onEdit}
                  onDelete={props.onDelete}
                  onToggleDisabled={props.onToggle}
                  selection={{
                    selected: props.selected,
                    disabled: props.disabled,
                    getId: (resource) => {
                      const target = getGeminiTarget(resource);
                      return target ? geminiTargetId(target) : resource.id;
                    },
                    onToggle: (resource, checked) => props.onSelect([resource], checked),
                    onTogglePage: (checked) => props.onSelect(keyPage.pageItems, checked),
                  }}
                />
                <div className={styles.pagination}>
                  <span>
                    {t('gemini_management.pageInfo', {
                      current: keyPage.currentPage,
                      total: keyPage.totalPages,
                      count: rows.length,
                    })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={keyPage.currentPage <= 1}
                    onClick={() =>
                      setKeyPages((pages) => ({ ...pages, [index]: keyPage.currentPage - 1 }))
                    }
                  >
                    {t('auth_files.pagination_prev')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={keyPage.currentPage >= keyPage.totalPages}
                    onClick={() =>
                      setKeyPages((pages) => ({ ...pages, [index]: keyPage.currentPage + 1 }))
                    }
                  >
                    {t('auth_files.pagination_next')}
                  </Button>
                </div>
              </div>
            )}
          </section>
        );
      })}
      <div className={styles.pagination}>
        <span>
          {t('gemini_groups.groupCount', { count: eligible.length })} · {currentPage} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={currentPage <= 1}
          onClick={() => setGroupPage(currentPage - 1)}
        >
          {t('auth_files.pagination_prev')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={currentPage >= totalPages}
          onClick={() => setGroupPage(currentPage + 1)}
        >
          {t('auth_files.pagination_next')}
        </Button>
      </div>
    </div>
  );
}
