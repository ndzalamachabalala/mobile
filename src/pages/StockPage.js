/**
 * mSupply Mobile
 * Sustainable Solutions (NZ) Ltd. 2016
 */

import React from 'react';
import PropTypes from 'prop-types';
import autobind from 'react-autobind';
import { Expansion } from 'react-native-data-table';
import { GenericPage } from './GenericPage';
import { PageInfo } from '../widgets';
import { dataTableStyles } from '../globalStyles';
import { formatDate, sortDataBy } from '../utilities';
import { tableStrings } from '../localization';

const DATA_TYPES_SYNCHRONISED = ['Item', 'ItemBatch', 'ItemCategory'];

/**
* Renders the page for all Items and their stock, with expansion of further details.
* @prop   {Realm}               database    App wide database.
* @prop   {func}                navigateTo  CallBack for navigation stack.
* @state  {Realm.Results}       items       Contains all Items stored on the local database.
*/
export class StockPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      items: props.database.objects('Item'),
    };
    this.dataFilters = {
      searchTerm: '',
      sortBy: 'name',
      isAscending: true,
    };
    autobind(this);
  }

  updateDataFilters(newSearchTerm, newSortBy, newIsAscending) {
    // We use != null, which checks for both null or undefined (undefined coerces to null)
    if (newSearchTerm != null) this.dataFilters.searchTerm = newSearchTerm;
    if (newSortBy != null) this.dataFilters.sortBy = newSortBy;
    if (newIsAscending != null) this.dataFilters.isAscending = newIsAscending;
  }

  /**
   * Returns updated data according to searchTerm, sortBy and isAscending.
   */
  refreshData(newSearchTerm, newSortBy, newIsAscending) {
    this.updateDataFilters(newSearchTerm, newSortBy, newIsAscending);
    const { searchTerm, sortBy, isAscending } = this.dataFilters;
    const data = this.state.items.filtered(
      'name BEGINSWITH[c] $0 OR code BEGINSWITH[c] $0',
      searchTerm
    );
    let sortDataType;
    switch (sortBy) {
      case 'totalQuantity':
        sortDataType = 'number';
        break;
      default:
        sortDataType = 'realm';
    }
    this.setState({
      data: sortDataBy(data, sortBy, sortDataType, isAscending),
    });
  }

  renderExpansion(item) {
    const earliestExpiringBatch = item.earliestExpiringBatch;
    const numberOfBatchesInStock = item.totalBatchesInStock;
    const infoColumns = [
      [
        {
          title: `${tableStrings.category}:`,
          info: item.categoryName,
        },
        {
          title: `${tableStrings.department}:`,
          info: item.departmentName,
        },
      ],
      [
        {
          title: `${tableStrings.number_of_batches}:`,
          info: numberOfBatchesInStock || 0,
        },
        {
          title: `${tableStrings.earliest_expiry}:`,
          info: earliestExpiringBatch
                && formatDate(earliestExpiringBatch.expiryDate),
        },
      ],
    ];
    return (
      <Expansion style={dataTableStyles.expansion}>
        <PageInfo columns={infoColumns} />
      </Expansion>
    );
  }

  render() {
    return (
      <GenericPage
        data={this.state.data}
        refreshData={this.refreshData}
        renderExpansion={this.renderExpansion}
        defaultSortKey={this.dataFilters.sortBy}
        defaultSortDirection={this.dataFilters.isAscending ? 'ascending' : 'descending'}
        columns={[
          {
            key: 'code',
            width: 1,
            title: tableStrings.item_code,
            sortable: true,
          },
          {
            key: 'name',
            width: 5,
            title: tableStrings.item_name,
            sortable: true,
          },
          {
            key: 'totalQuantity',
            width: 1,
            title: tableStrings.stock_on_hand,
            sortable: true,
            alignText: 'right',
          },
        ]}
        dataTypesSynchronised={DATA_TYPES_SYNCHRONISED}
        database={this.props.database}
        {...this.props.genericTablePageStyles}
        topRoute={this.props.topRoute}
      />
    );
  }
}

StockPage.propTypes = {
  database: PropTypes.object,
  genericTablePageStyles: PropTypes.object,
  topRoute: PropTypes.bool,
  navigateTo: PropTypes.func.isRequired,
};
